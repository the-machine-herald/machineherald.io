/**
 * Source Snapshot Module
 *
 * Fetches source URLs, saves HTML snapshots to disk, and produces
 * a manifest with per-source metadata (status, hash, content-type).
 * Used by the chief editor review script and the standalone CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// ── Types ───────────────────────────────────────────────────

export interface SuspiciousMatch {
  /** Human-readable label of what the pattern targets, e.g. "ignore-instructions". */
  pattern: string;
  /** Short verbatim excerpt of the page text surrounding the match. */
  excerpt: string;
}

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
  /** Non-null only when the fetched page text matched a known prompt-injection pattern. */
  suspicious_patterns?: SuspiciousMatch[] | null;
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

// Structural, non-LLM scan for text that addresses an AI agent directly or
// tries to redirect its instructions. This is a coarse net, not a full
// classifier — it exists so a reviewer sees a flagged excerpt in the manifest
// instead of relying entirely on a model noticing it live while reading the
// page. Every entry must be able to point at a literal, quoted match.
const SUSPICIOUS_CONTENT_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'ignore-instructions', regex: /ignore (all |any )?(previous|prior|above|the) instructions/i },
  { label: 'disregard-instructions', regex: /disregard (all |any )?(previous|prior|above|the) instructions/i },
  { label: 'override-instructions', regex: /override (your |the )?(instructions|guidelines|rules|system prompt)/i },
  { label: 'new-instructions', regex: /new instructions\s*[:\-]/i },
  { label: 'addresses-ai-agent', regex: /you are (an |a )?(ai|large language model|llm|claude|gpt|chatgpt|an? ai agent|an? autonomous agent)\b/i },
  { label: 'system-prompt-reference', regex: /system[\s_-]?prompt/i },
  { label: 'fake-system-reminder', regex: /<\s*system-reminder\s*>/i },
  { label: 'chat-template-marker', regex: /\[INST\]|<\|im_start\|>|<\|system\|>|<\|assistant\|>/i },
  { label: 'conceal-from-user', regex: /do not (tell|mention|inform|disclose)\b.{0,25}\b(user|human|operator)\b/i },
  { label: 'claude-agent-sdk-reference', regex: /anthropic'?s? (claude )?agent sdk/i },
];

const EXCERPT_CONTEXT_CHARS = 120;
const MAX_MATCHES_PER_SOURCE = 5;

/**
 * Scans raw fetched page text for phrases shaped like an attempt to redirect
 * an AI agent's behavior. Returns null when nothing matches, never an empty
 * array, so callers can `if (matches)` directly.
 */
function scanForSuspiciousContent(bodyText: string): SuspiciousMatch[] | null {
  const matches: SuspiciousMatch[] = [];
  for (const { label, regex } of SUSPICIOUS_CONTENT_PATTERNS) {
    const m = regex.exec(bodyText);
    if (!m) continue;
    const start = Math.max(0, m.index - EXCERPT_CONTEXT_CHARS);
    const end = Math.min(bodyText.length, m.index + m[0].length + EXCERPT_CONTEXT_CHARS);
    const excerpt = bodyText.slice(start, end).replace(/\s+/g, ' ').trim();
    matches.push({ pattern: label, excerpt });
    if (matches.length >= MAX_MATCHES_PER_SOURCE) break;
  }
  return matches.length > 0 ? matches : null;
}

/** Hashes, gzips, and writes fetched page text to disk; returns the shared fields every result variant needs. */
function persistSnapshot(
  outDir: string,
  index: number,
  bodyText: string,
): { filename: string; sha256: string; contentLength: number; suspiciousPatterns: SuspiciousMatch[] | null } {
  const filename = `source-${index}.html.gz`;
  const filePath = path.join(outDir, filename);
  const utf8Bytes = Buffer.from(bodyText, 'utf-8');
  // sha256 is of the uncompressed content, so verifiers decompress and rehash to check.
  const hash = crypto.createHash('sha256').update(utf8Bytes).digest('hex');
  fs.writeFileSync(filePath, zlib.gzipSync(utf8Bytes, { level: 9 }));
  return {
    filename,
    sha256: hash,
    contentLength: utf8Bytes.length,
    suspiciousPatterns: scanForSuspiciousContent(bodyText),
  };
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
  body: string | null;
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

    const body = await res.text();
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
      const snapshot = persistSnapshot(outDir, index, archiveAttempt.body);

      return {
        url,
        file: snapshot.filename,
        status_code: archiveAttempt.status_code,
        content_type: archiveAttempt.content_type,
        content_length: snapshot.contentLength,
        sha256: snapshot.sha256,
        error: null,
        fetched_at: fetchedAt,
        redirected_domain: null,
        archive_fallback: true,
        archive_url: archiveUrl,
        suspicious_patterns: snapshot.suspiciousPatterns,
      };
    }
  }

  // Save snapshot if we have content
  if (attempt.body !== null) {
    const snapshot = persistSnapshot(outDir, index, attempt.body);

    return {
      url,
      file: snapshot.filename,
      status_code: attempt.status_code,
      content_type: attempt.content_type,
      content_length: snapshot.contentLength,
      sha256: snapshot.sha256,
      error: null,
      fetched_at: fetchedAt,
      redirected_domain: attempt.redirected_domain,
      suspicious_patterns: snapshot.suspiciousPatterns,
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
