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
}

// ── Helpers ─────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

const PIPELINE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
    );
    return pkg.version || '3.0.0';
  } catch {
    return '3.0.0';
  }
})();

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

// ── Single-source fetch ─────────────────────────────────────

async function fetchSource(
  url: string,
  index: number,
  outDir: string,
  timeoutMs: number,
): Promise<SourceFetchResult> {
  const fetchedAt = new Date().toISOString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': `MachineHerald-ReviewBot/${PIPELINE_VERSION}`,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });

    const statusCode = res.status;
    const contentType = res.headers.get('content-type');

    // Detect cross-domain redirects
    let redirectedDomain: string | null = null;
    const finalDomain = extractDomain(res.url);
    const originalDomain = extractDomain(url);
    if (finalDomain && originalDomain && finalDomain !== originalDomain) {
      redirectedDomain = finalDomain;
    }

    if (statusCode >= 400) {
      return {
        url,
        file: null,
        status_code: statusCode,
        content_type: contentType,
        content_length: null,
        sha256: null,
        error: res.statusText || `HTTP ${statusCode}`,
        fetched_at: fetchedAt,
        redirected_domain: redirectedDomain,
      };
    }

    const body = await res.text();
    const filename = `source-${index}.html`;
    const filePath = path.join(outDir, filename);
    fs.writeFileSync(filePath, body, 'utf-8');

    const hash = crypto.createHash('sha256').update(body).digest('hex');

    return {
      url,
      file: filename,
      status_code: statusCode,
      content_type: contentType,
      content_length: Buffer.byteLength(body, 'utf-8'),
      sha256: hash,
      error: null,
      fetched_at: fetchedAt,
      redirected_domain: redirectedDomain,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Timeout after ${timeoutMs}ms`
          : err.message
        : String(err);

    return {
      url,
      file: null,
      status_code: null,
      content_type: null,
      content_length: null,
      sha256: null,
      error: message,
      fetched_at: fetchedAt,
      redirected_domain: null,
    };
  } finally {
    clearTimeout(timer);
  }
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

  const monthFolder = getMonthFromSubmissionPath(submissionPath);
  const articleSlug = slugify(articleTitle);
  const snapshotDir = path.join(baseDir, monthFolder, articleSlug);

  fs.mkdirSync(snapshotDir, { recursive: true });

  const results = await Promise.allSettled(
    sources.map((url, i) => fetchSource(url, i, snapshotDir, timeoutMs)),
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
    (s) => s.status_code !== null && s.status_code >= 200 && s.status_code < 400,
  );

  return { manifestPath, snapshotDir, sources: sourceResults, allReachable };
}
