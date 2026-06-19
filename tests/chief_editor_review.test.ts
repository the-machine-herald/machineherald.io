import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Mock source_snapshot before importing the review module
vi.mock('../scripts/lib/source_snapshot', () => ({
  fetchAndSnapshotSources: vi.fn(),
}));

import {
  reviewSubmission,
  findOrphanBodyURLs,
  extractMarkdownLinkDestinations,
  PROBLEMATIC_PATTERNS,
} from '../scripts/chief_editor_review';
import { fetchAndSnapshotSources } from '../scripts/lib/source_snapshot';
import type { SnapshotResult, SourceFetchResult } from '../scripts/lib/source_snapshot';

const mockedFetchAndSnapshot = vi.mocked(fetchAndSnapshotSources);

let tmpDir: string;
let submissionPath: string;

function makeSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const article = {
    title: 'Test Article For Review',
    category: 'News',
    summary: 'This is a valid summary for the test article about technology advances.',
    tags: ['ai', 'test'],
    sources: [
      'https://reuters.com/article/test-1',
      'https://bbc.com/news/test-2',
    ],
    body_markdown:
      'According to [Reuters](https://reuters.com/article/test-1), significant progress has been made. ' +
      'The BBC [reports](https://bbc.com/news/test-2) similar findings. ' +
      'This development marks a notable shift in the industry, with multiple stakeholders weighing in on the implications. ' +
      'Analysts suggest the trend will continue through the remainder of the year, though uncertainty remains about long-term outcomes. ' +
      'Industry leaders have responded with cautious optimism, noting that further research is needed before drawing definitive conclusions. ' +
      'The findings align with earlier projections from several research institutions. ' +
      'Public reaction has been measured, with most observers taking a wait-and-see approach.',
    ...(overrides.article as Record<string, unknown> || {}),
  };

  const base: Record<string, unknown> = {
    submission_version: 3,
    bot_id: 'test-bot',
    timestamp: '2026-02-18T10:00:00Z',
    human_requested: false,
    contributor_model: 'Test Model v1',
    article,
    ...overrides,
  };

  // Compute real payload_hash and placeholder signature
  const normalized: Record<string, unknown> = {
    submission_version: base.submission_version,
    bot_id: base.bot_id,
    timestamp: base.timestamp,
    human_requested: base.human_requested,
    contributor_model: base.contributor_model,
  };
  normalized.article = {
    title: article.title,
    category: article.category,
    summary: article.summary,
    tags: [...article.tags].sort(),
    sources: [...article.sources].sort(),
    body_markdown: article.body_markdown,
  };
  const payload = JSON.stringify(normalized, null, 0);
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  base.payload_hash = base.payload_hash ?? `sha256:${hash}`;
  base.signature = base.signature ?? 'ed25519:dGVzdHNpZ25hdHVyZQ==';

  return base;
}

function makeSnapshotResult(
  sources: SourceFetchResult[],
  allReachable: boolean,
): SnapshotResult {
  return {
    manifestPath: '/tmp/manifest.json',
    snapshotDir: '/tmp/snapshots',
    sources,
    allReachable,
  };
}

function makeOkSource(url: string, index: number): SourceFetchResult {
  return {
    url,
    file: `source-${index}.html`,
    status_code: 200,
    content_type: 'text/html',
    content_length: 1000,
    sha256: 'abc123',
    error: null,
    fetched_at: '2026-02-18T10:00:00Z',
    redirected_domain: null,
  };
}

function makeDeadSource(url: string): SourceFetchResult {
  return {
    url,
    file: null,
    status_code: 404,
    content_type: null,
    content_length: null,
    sha256: null,
    error: 'Not Found',
    fetched_at: '2026-02-18T10:00:00Z',
    redirected_domain: null,
  };
}

function makeUnreachableSource(url: string): SourceFetchResult {
  return {
    url,
    file: null,
    status_code: null,
    content_type: null,
    content_length: null,
    sha256: null,
    error: 'fetch failed',
    fetched_at: '2026-02-18T10:00:00Z',
    redirected_domain: null,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-review-test-'));

  const submission = makeSubmission();
  submissionPath = path.join(tmpDir, 'test_submission.json');
  fs.writeFileSync(submissionPath, JSON.stringify(submission, null, 2));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('reviewSubmission with source snapshots', () => {
  it('sets sources_reachable to true when all sources return 200', async () => {
    mockedFetchAndSnapshot.mockResolvedValue(
      makeSnapshotResult(
        [
          makeOkSource('https://reuters.com/article/test-1', 0),
          makeOkSource('https://bbc.com/news/test-2', 1),
        ],
        true,
      ),
    );

    const report = await reviewSubmission(submissionPath);

    expect(report.checklist['sources_reachable']).toBe(true);
    const deadLinkFindings = report.findings.filter((f) =>
      f.message.startsWith('Dead link'),
    );
    expect(deadLinkFindings).toHaveLength(0);
  });

  it('sets sources_reachable to false and adds error findings for dead links', async () => {
    mockedFetchAndSnapshot.mockResolvedValue(
      makeSnapshotResult(
        [
          makeOkSource('https://reuters.com/article/test-1', 0),
          makeDeadSource('https://bbc.com/news/test-2'),
        ],
        false,
      ),
    );

    const report = await reviewSubmission(submissionPath);

    expect(report.checklist['sources_reachable']).toBe(false);
    const deadLinkFindings = report.findings.filter((f) =>
      f.message.startsWith('Dead link'),
    );
    expect(deadLinkFindings).toHaveLength(1);
    expect(deadLinkFindings[0]!.severity).toBe('error');
    expect(deadLinkFindings[0]!.details).toBe('https://bbc.com/news/test-2');
  });

  it('adds warning findings for unreachable sources', async () => {
    mockedFetchAndSnapshot.mockResolvedValue(
      makeSnapshotResult(
        [
          makeOkSource('https://reuters.com/article/test-1', 0),
          makeUnreachableSource('https://bbc.com/news/test-2'),
        ],
        false,
      ),
    );

    const report = await reviewSubmission(submissionPath);

    const unreachableFindings = report.findings.filter((f) =>
      f.message.startsWith('Source unreachable'),
    );
    expect(unreachableFindings).toHaveLength(1);
    expect(unreachableFindings[0]!.severity).toBe('warning');
  });

  it('dead links produce errors that influence the verdict toward REJECT', async () => {
    mockedFetchAndSnapshot.mockResolvedValue(
      makeSnapshotResult(
        [
          makeDeadSource('https://reuters.com/article/test-1'),
          makeDeadSource('https://bbc.com/news/test-2'),
        ],
        false,
      ),
    );

    const report = await reviewSubmission(submissionPath);

    expect(report.verdict).toBe('REJECT');
  });

  it('adds info finding for cross-domain redirect', async () => {
    const redirectedSource: SourceFetchResult = {
      ...makeOkSource('https://reuters.com/article/test-1', 0),
      redirected_domain: 'cdn.reuters.com',
    };

    mockedFetchAndSnapshot.mockResolvedValue(
      makeSnapshotResult(
        [
          redirectedSource,
          makeOkSource('https://bbc.com/news/test-2', 1),
        ],
        true,
      ),
    );

    const report = await reviewSubmission(submissionPath);

    const redirectFindings = report.findings.filter((f) =>
      f.message.includes('redirected to different domain'),
    );
    expect(redirectFindings).toHaveLength(1);
    expect(redirectFindings[0]!.severity).toBe('info');
  });

  it('existing review logic still works (hash validation, content checks, etc.)', async () => {
    mockedFetchAndSnapshot.mockResolvedValue(
      makeSnapshotResult(
        [
          makeOkSource('https://reuters.com/article/test-1', 0),
          makeOkSource('https://bbc.com/news/test-2', 1),
        ],
        true,
      ),
    );

    const report = await reviewSubmission(submissionPath);

    // Core integrity checks should still run
    expect(report.checklist['version_valid']).toBe(true);
    expect(report.checklist['hash_valid']).toBe(true);
    expect(report.checklist['signature_format']).toBe(true);
    expect(report.checklist['sources_count']).toBe(true);
    expect(report.checklist['sources_https']).toBe(true);
    expect(report.checklist['title_present']).toBe(true);
  });
});

describe('extractMarkdownLinkDestinations / findOrphanBodyURLs', () => {
  it('captures the full URL when the destination contains balanced parentheses', () => {
    const body =
      'See [Wikipedia](https://en.wikipedia.org/wiki/Star_Fox_(2026_video_game)) for details.';
    expect(extractMarkdownLinkDestinations(body)).toEqual([
      'https://en.wikipedia.org/wiki/Star_Fox_(2026_video_game)',
    ]);
  });

  it('does NOT flag a parenthesized URL as orphan when it is present in sources', () => {
    const url = 'https://en.wikipedia.org/wiki/Star_Fox_(2026_video_game)';
    const body = `As reported by [Wikipedia](${url}), the remake ships in June.`;
    // Regression: the old `[^)]+` regex truncated the URL at the inner ")",
    // so the source set never matched and this produced a false-positive orphan.
    expect(findOrphanBodyURLs(body, [url])).toEqual([]);
  });

  it('flags a genuinely missing parenthesized URL with both parens intact', () => {
    const url = 'https://en.wikipedia.org/wiki/Star_Fox_(2026_video_game)';
    const body = `As reported by [Wikipedia](${url}).`;
    expect(findOrphanBodyURLs(body, ['https://reuters.com/x'])).toEqual([url]);
  });

  it('still handles plain URLs, dedupes, and ignores non-http destinations', () => {
    const body =
      '[A](https://a.com/p) and [again](https://a.com/p) and [B](https://b.com/q) ' +
      'and an [internal](/article/2026-06/some-slug) link.';
    expect(findOrphanBodyURLs(body, ['https://a.com/p'])).toEqual(['https://b.com/q']);
  });

  it('stops the destination at a link title and keeps the URL clean', () => {
    const body = '[A](https://a.com/p "the title")';
    expect(extractMarkdownLinkDestinations(body)).toEqual(['https://a.com/p']);
  });
});

describe('PROBLEMATIC_PATTERNS — AI self-reference', () => {
  function hasAiSelfReference(text: string): boolean {
    return PROBLEMATIC_PATTERNS.some(
      (p) => p.message === 'Contains AI self-reference' && p.pattern.test(text),
    );
  }

  it('flags genuine AI self-references', () => {
    expect(hasAiSelfReference('As an AI, I cannot verify this.')).toBe(true);
    expect(hasAiSelfReference("I'm an AI assistant.")).toBe(true);
    expect(hasAiSelfReference('I am an AI and...')).toBe(true);
    expect(hasAiSelfReference('As a language model, I...')).toBe(true);
  });

  it('does NOT flag innocent words that merely start with "ai"', () => {
    // Regression: the old /as an ai/i matched the substring inside "air-taxi".
    expect(hasAiSelfReference('Archer was selected as an air-taxi partner.')).toBe(false);
    expect(hasAiSelfReference('Building as an aircraft maker for decades.')).toBe(false);
    expect(hasAiSelfReference('regarded as an aid to recovery')).toBe(false);
  });
});
