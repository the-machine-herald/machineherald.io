/**
 * Source Snapshot Module
 *
 * Fetches source URLs, saves snapshots to disk, and produces a manifest with
 * per-source metadata (status, hash, content-type). Textual sources (HTML/XML/
 * JSON) are stored as decoded UTF-8; binary sources (e.g. application/pdf) are
 * stored as the exact bytes received — never lossily UTF-8-decoded.
 * Used by the chief editor review script and the standalone CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// ── Types ───────────────────────────────────────────────────

export interface SourceFetchResult {
  url: string;
  file: string | null;
  status_code: number | null;
  content_type: string | null;
  content_length: number | null;
  sha256: string | null;
  error: string | null;
  fetched_at: string;
  redirected_domain: string | null;
  archive_fallback?: boolean;
  archive_url?: string | null;
}

export interface SourceManifest {
  submission_file: string;
  article_title: string;
  fetched_at: string;
  sources: SourceFetchResult[];
}

export interface SnapshotResult {
  manifestPath: string;
  snapshotDir: string;
  sources: SourceFetchResult[];
  allReachable: boolean;
}

export interface SnapshotOptions {
  /** Override the root directory for snapshots (default: `sources/` at project root). */
  baseDir?: string;
  /** Per-request timeout in ms (default: 15 000). */
  timeoutMs?: number;
  /** Delay between retry attempts in ms (default: 3 000). Set to 0 in tests. */
  retryDelayMs?: number;
}

// ── Helpers ─────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 3_000;

// Status codes that warrant a retry (transient failures)
const RETRYABLE_STATUS_CODES = new Set([403, 429, 500, 502, 503, 504]);

// Status codes that indicate bot-blocking (worth trying archive.org)
const BOT_BLOCKED_STATUS_CODES = new Set([403, 401]);

// Browser-like request headers to reduce bot detection
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Whether a response body should be stored as decoded UTF-8 text (honoring the
 * response charset via res.text()) rather than as raw bytes. Everything that is
 * not textual — PDFs, images, octet-streams — is stored byte-for-byte, because
 * res.text() replaces any non-UTF-8 byte with U+FFFD and corrupts binary content
 * before it is hashed. A null/absent content-type defaults to text, preserving
 * the module's historical behavior for untyped responses.
 */
function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const type = contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (type.startsWith('text/')) return true;
  if (type.endsWith('+xml') || type.endsWith('+json')) return true;
  return (
    type === 'application/xml' ||
    type === 'application/json' ||
    type === 'application/javascript' ||
    type === 'application/ecmascript'
  );
}

/**
 * Snapshot filename extension for a content type. Textual sources keep the
 * historical `.html.gz` name; PDFs and other binaries get an accurate extension
 * so reviewers know which tool to open them with.
 */
function snapshotExtension(contentType: string | null): string {
  if (isTextualContentType(contentType)) return 'html';
  const type = (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  return 'bin';
}

function getMonthFromSubmissionPath(submissionPath: string): string {
  const basename = path.basename(submissionPath, '.json');
  const match = basename.match(/^(\d{4}-\d{2})/);
  if (match) return match[1]!;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Single-URL fetch attempt ─────────────────────────────────

interface FetchAttemptResult {
  status_code: number | null;
  content_type: string | null;
  redirected_domain: string | null;
  /** Exact bytes to persist: decoded UTF-8 for text, raw bytes for binary. */
  body: Buffer | null;
  error: string | null;
}

async function attemptFetch(
  url: string,
  originalUrl: string,
  timeoutMs: number,
): Promise<FetchAttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });

    const statusCode = res.status;
    const contentType = res.headers.get('content-type');

    // Detect cross-domain redirects relative to the original (not archive) URL
    let redirectedDomain: string | null = null;
    const finalDomain = extractDomain(res.url);
    const sourceDomain = extractDomain(originalUrl);
    if (finalDomain && sourceDomain && finalDomain !== sourceDomain) {
      redirectedDomain = finalDomain;
    }

    if (statusCode >= 400) {
      return {
        status_code: statusCode,
        content_type: contentType,
        redirected_domain: redirectedDomain,
        body: null,
        error: res.statusText || `HTTP ${statusCode}`,
      };
    }

    // Textual sources are stored as decoded UTF-8 (res.text() honors the response
    // charset); binary sources are stored as the exact bytes received. Reading a
    // binary body with res.text() would replace every non-UTF-8 byte with U+FFFD,
    // corrupting the snapshot before it is hashed.
    const body = isTextualContentType(contentType)
      ? Buffer.from(await res.text(), 'utf-8')
      : Buffer.from(await res.arrayBuffer());
    return {
      status_code: statusCode,
      content_type: contentType,
      redirected_domain: redirectedDomain,
      body,
      error: null,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Timeout after ${timeoutMs}ms`
          : err.message
        : String(err);
    return {
      status_code: null,
      content_type: null,
      redirected_domain: null,
      body: null,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Single-source fetch (with retry + archive fallback) ─────

async function fetchSource(
  url: string,
  index: number,
  outDir: string,
  timeoutMs: number,
  retryDelayMs: number,
): Promise<SourceFetchResult> {
  const fetchedAt = new Date().toISOString();

  // First attempt
  let attempt = await attemptFetch(url, url, timeoutMs);

  // Retry once for transient errors (403, 429, 5xx)
  if (attempt.status_code !== null && RETRYABLE_STATUS_CODES.has(attempt.status_code)) {
    await sleep(retryDelayMs);
    attempt = await attemptFetch(url, url, timeoutMs);
  }

  // Archive.org fallback for persistent bot-blocked responses
  if (attempt.status_code !== null && BOT_BLOCKED_STATUS_CODES.has(attempt.status_code)) {
    const archiveUrl = `https://web.archive.org/web/${url}`;
    const archiveAttempt = await attemptFetch(archiveUrl, url, timeoutMs);

    if (archiveAttempt.status_code !== null && archiveAttempt.status_code < 400 && archiveAttempt.body !== null) {
      const filename = `source-${index}.${snapshotExtension(archiveAttempt.content_type)}.gz`;
      const filePath = path.join(outDir, filename);
      const bytes = archiveAttempt.body;
      // sha256 is of the uncompressed content, so verifiers decompress and rehash to check.
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      fs.writeFileSync(filePath, zlib.gzipSync(bytes, { level: 9 }));

      return {
        url,
        file: filename,
        status_code: archiveAttempt.status_code,
        content_type: archiveAttempt.content_type,
        content_length: bytes.length,
        sha256: hash,
        error: null,
        fetched_at: fetchedAt,
        redirected_domain: null,
        archive_fallback: true,
        archive_url: archiveUrl,
      };
    }
  }

  // Save snapshot if we have content
  if (attempt.body !== null) {
    const filename = `source-${index}.${snapshotExtension(attempt.content_type)}.gz`;
    const filePath = path.join(outDir, filename);
    const bytes = attempt.body;
    // sha256 is of the uncompressed content, so verifiers decompress and rehash to check.
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(filePath, zlib.gzipSync(bytes, { level: 9 }));

    return {
      url,
      file: filename,
      status_code: attempt.status_code,
      content_type: attempt.content_type,
      content_length: bytes.length,
      sha256: hash,
      error: null,
      fetched_at: fetchedAt,
      redirected_domain: attempt.redirected_domain,
    };
  }

  // No content — return error result
  return {
    url,
    file: null,
    status_code: attempt.status_code,
    content_type: attempt.content_type,
    content_length: null,
    sha256: null,
    error: attempt.error,
    fetched_at: fetchedAt,
    redirected_domain: attempt.redirected_domain,
  };
}

// ── Main entry point ────────────────────────────────────────

export async function fetchAndSnapshotSources(
  sources: string[],
  submissionPath: string,
  articleTitle: string,
  options?: SnapshotOptions,
): Promise<SnapshotResult> {
  const baseDir = options?.baseDir ?? path.join(process.cwd(), 'sources');
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options?.retryDelayMs ?? RETRY_DELAY_MS;

  const monthFolder = getMonthFromSubmissionPath(submissionPath);
  const articleSlug = slugify(articleTitle);
  const snapshotDir = path.join(baseDir, monthFolder, articleSlug);

  fs.mkdirSync(snapshotDir, { recursive: true });

  const results = await Promise.allSettled(
    sources.map((url, i) => fetchSource(url, i, snapshotDir, timeoutMs, retryDelayMs)),
  );

  const sourceResults: SourceFetchResult[] = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          url: sources[i]!,
          file: null,
          status_code: null,
          content_type: null,
          content_length: null,
          sha256: null,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          fetched_at: new Date().toISOString(),
          redirected_domain: null,
        },
  );

  const normalizedSubmissionPath = path.isAbsolute(submissionPath)
    ? path.relative(process.cwd(), submissionPath)
    : submissionPath;

  const manifest: SourceManifest = {
    submission_file: normalizedSubmissionPath,
    article_title: articleTitle,
    fetched_at: new Date().toISOString(),
    sources: sourceResults,
  };

  const manifestPath = path.join(snapshotDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const allReachable = sourceResults.every(
    (s) =>
      (s.status_code !== null && s.status_code >= 200 && s.status_code < 400) ||
      s.archive_fallback === true,
  );

  return { manifestPath, snapshotDir, sources: sourceResults, allReachable };
}
