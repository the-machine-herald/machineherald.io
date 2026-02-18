import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fetchAndSnapshotSources, slugify } from '../scripts/lib/source_snapshot';
import type { SourceManifest } from '../scripts/lib/source_snapshot';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-snapshot-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(handler(url));
    },
  );
}

function makeResponse(body: string, init?: ResponseInit & { url?: string }): Response {
  const res = new Response(body, init);
  if (init?.url) {
    Object.defineProperty(res, 'url', { value: init.url });
  }
  return res;
}

// ── slugify ───────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World Test')).toBe('hello-world-test');
  });

  it('removes special characters', () => {
    expect(slugify('India Unveils $200 Billion AI Push')).toBe(
      'india-unveils-200-billion-ai-push',
    );
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo---bar')).toBe('foo-bar');
  });
});

// ── fetchAndSnapshotSources ─────────────────────────────

describe('fetchAndSnapshotSources', () => {
  const submissionPath = 'src/content/submissions/2026-02/2026-02-18T10-00-00Z_test-article.json';
  const articleTitle = 'Test Article Title';

  it('saves HTML snapshot and writes correct manifest for a 200 response', async () => {
    const html = '<html><body>Reuters content</body></html>';

    mockFetch((url) =>
      makeResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        url,
      }),
    );

    const result = await fetchAndSnapshotSources(
      ['https://reuters.com/article/test'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    expect(result.allReachable).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.status_code).toBe(200);
    expect(result.sources[0]!.file).toBe('source-0.html');
    expect(result.sources[0]!.error).toBeNull();

    // Verify file on disk
    const savedHtml = fs.readFileSync(
      path.join(result.snapshotDir, 'source-0.html'),
      'utf-8',
    );
    expect(savedHtml).toBe(html);

    // Verify SHA-256 matches
    const expectedHash = crypto.createHash('sha256').update(html).digest('hex');
    expect(result.sources[0]!.sha256).toBe(expectedHash);

    // Verify manifest
    const manifest: SourceManifest = JSON.parse(
      fs.readFileSync(result.manifestPath, 'utf-8'),
    );
    expect(manifest.submission_file).toBe(submissionPath);
    expect(manifest.article_title).toBe(articleTitle);
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0]!.sha256).toBe(expectedHash);
  });

  it('reports error finding for a 404 response', async () => {
    mockFetch((url) =>
      makeResponse('Not Found', {
        status: 404,
        statusText: 'Not Found',
        url,
      }),
    );

    const result = await fetchAndSnapshotSources(
      ['https://reuters.com/gone'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    expect(result.allReachable).toBe(false);
    expect(result.sources[0]!.status_code).toBe(404);
    expect(result.sources[0]!.file).toBeNull();
    expect(result.sources[0]!.error).toBe('Not Found');
  });

  it('reports error for network/connection failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed'),
    );

    const result = await fetchAndSnapshotSources(
      ['https://unreachable.example.com/article'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    expect(result.allReachable).toBe(false);
    expect(result.sources[0]!.status_code).toBeNull();
    expect(result.sources[0]!.error).toBe('fetch failed');
    expect(result.sources[0]!.file).toBeNull();
  });

  it('reports timeout as error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    const result = await fetchAndSnapshotSources(
      ['https://slow.example.com/article'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir, timeoutMs: 100 },
    );

    expect(result.allReachable).toBe(false);
    expect(result.sources[0]!.error).toContain('Timeout');
  });

  it('detects cross-domain redirects', async () => {
    mockFetch(() =>
      makeResponse('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        url: 'https://otherdomain.com/redirected',
      }),
    );

    const result = await fetchAndSnapshotSources(
      ['https://original.com/article'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    expect(result.allReachable).toBe(true);
    expect(result.sources[0]!.redirected_domain).toBe('otherdomain.com');
  });

  it('creates correct directory structure (YYYY-MM/slug)', async () => {
    mockFetch((url) =>
      makeResponse('<html></html>', { status: 200, url }),
    );

    const result = await fetchAndSnapshotSources(
      ['https://example.com/a'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    const relative = path.relative(tmpDir, result.snapshotDir);
    expect(relative).toBe(path.join('2026-02', 'test-article-title'));
  });

  it('handles multiple sources concurrently', async () => {
    const urls = [
      'https://reuters.com/a',
      'https://bbc.com/b',
      'https://nytimes.com/c',
    ];

    mockFetch((url) =>
      makeResponse(`<html>${url}</html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        url,
      }),
    );

    const result = await fetchAndSnapshotSources(
      urls,
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    expect(result.allReachable).toBe(true);
    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]!.file).toBe('source-0.html');
    expect(result.sources[1]!.file).toBe('source-1.html');
    expect(result.sources[2]!.file).toBe('source-2.html');

    // Verify each file is distinct
    for (let i = 0; i < 3; i++) {
      const content = fs.readFileSync(
        path.join(result.snapshotDir, `source-${i}.html`),
        'utf-8',
      );
      expect(content).toBe(`<html>${urls[i]}</html>`);
    }
  });

  it('marks allReachable false when any source fails', async () => {
    let callIndex = 0;
    mockFetch((url) => {
      callIndex++;
      if (callIndex === 2) {
        return makeResponse('Server Error', { status: 500, statusText: 'Internal Server Error', url });
      }
      return makeResponse('<html></html>', { status: 200, url });
    });

    const result = await fetchAndSnapshotSources(
      ['https://good.com/a', 'https://bad.com/b'],
      submissionPath,
      articleTitle,
      { baseDir: tmpDir },
    );

    expect(result.allReachable).toBe(false);
    expect(result.sources[0]!.status_code).toBe(200);
    expect(result.sources[1]!.status_code).toBe(500);
  });
});
