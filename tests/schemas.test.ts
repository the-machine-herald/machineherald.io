import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  sourceManifestSchema,
  sourceFetchResultSchema,
  reviewChecklistSchema,
  reviewSchema,
} from '../src/lib/schemas';

// ── sourceManifestSchema ────────────────────────────────

describe('sourceManifestSchema', () => {
  const validManifest = {
    submission_file: 'src/content/submissions/2026-02/2026-02-18T10-00-00Z_test.json',
    article_title: 'Test Article',
    fetched_at: '2026-02-18T10:00:00.000Z',
    sources: [
      {
        url: 'https://reuters.com/article/test',
        file: 'source-0.html',
        status_code: 200,
        content_type: 'text/html; charset=utf-8',
        content_length: 45230,
        sha256: 'abcdef1234567890',
        error: null,
        fetched_at: '2026-02-18T10:00:01.000Z',
        redirected_domain: null,
      },
    ],
  };

  it('accepts a valid manifest', () => {
    const result = sourceManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it('accepts a manifest with a failed source (file null, status 404)', () => {
    const manifest = {
      ...validManifest,
      sources: [
        {
          url: 'https://example.com/gone',
          file: null,
          status_code: 404,
          content_type: null,
          content_length: null,
          sha256: null,
          error: 'Not Found',
          fetched_at: '2026-02-18T10:00:02.000Z',
          redirected_domain: null,
        },
      ],
    };
    const result = sourceManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('accepts a manifest with a network-error source (status null)', () => {
    const manifest = {
      ...validManifest,
      sources: [
        {
          url: 'https://unreachable.example.com/x',
          file: null,
          status_code: null,
          content_type: null,
          content_length: null,
          sha256: null,
          error: 'fetch failed',
          fetched_at: '2026-02-18T10:00:03.000Z',
          redirected_domain: null,
        },
      ],
    };
    const result = sourceManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('accepts a manifest with a redirected source', () => {
    const manifest = {
      ...validManifest,
      sources: [
        {
          ...validManifest.sources[0],
          redirected_domain: 'cdn.reuters.com',
        },
      ],
    };
    const result = sourceManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('rejects a manifest with missing submission_file', () => {
    const { submission_file: _, ...incomplete } = validManifest;
    const result = sourceManifestSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects a manifest with empty sources array', () => {
    const manifest = { ...validManifest, sources: [] };
    const result = sourceManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it('rejects a source with an invalid URL', () => {
    const manifest = {
      ...validManifest,
      sources: [
        { ...validManifest.sources[0], url: 'not-a-url' },
      ],
    };
    const result = sourceManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});

// ── sourceFetchResultSchema ─────────────────────────────

describe('sourceFetchResultSchema', () => {
  it('accepts a successful fetch result', () => {
    const result = sourceFetchResultSchema.safeParse({
      url: 'https://example.com/article',
      file: 'source-0.html',
      status_code: 200,
      content_type: 'text/html',
      content_length: 1234,
      sha256: 'abc123',
      error: null,
      fetched_at: '2026-02-18T10:00:00Z',
      redirected_domain: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects if url is missing', () => {
    const result = sourceFetchResultSchema.safeParse({
      file: null,
      status_code: null,
      content_type: null,
      content_length: null,
      sha256: null,
      error: 'missing url',
      fetched_at: '2026-02-18T10:00:00Z',
      redirected_domain: null,
    });
    expect(result.success).toBe(false);
  });
});

// ── reviewChecklistSchema backward compatibility ────────

describe('reviewChecklistSchema', () => {
  const baseChecklist = {
    version_valid: true,
    bot_id_present: true,
    bot_registered: true,
    timestamp_valid: true,
    hash_valid: true,
    signature_format: true,
    sources_count: true,
    sources_https: true,
    no_blocklisted_domains: true,
    title_present: true,
    title_reasonable_length: true,
    summary_valid: true,
    body_length_appropriate: true,
    sources_referenced: true,
    tags_present: true,
  };

  it('accepts checklist WITHOUT sources_reachable (backward compat)', () => {
    const result = reviewChecklistSchema.safeParse(baseChecklist);
    expect(result.success).toBe(true);
  });

  it('accepts checklist WITH sources_reachable', () => {
    const result = reviewChecklistSchema.safeParse({
      ...baseChecklist,
      sources_reachable: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts checklist with sources_reachable = false', () => {
    const result = reviewChecklistSchema.safeParse({
      ...baseChecklist,
      sources_reachable: false,
    });
    expect(result.success).toBe(true);
  });
});

// ── Existing review files still validate ────────────────

describe('existing review files validate against updated schema', () => {
  const reviewsDir = path.join(process.cwd(), 'src/content/reviews');

  function collectReviewFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectReviewFiles(full));
      } else if (entry.name.endsWith('.json')) {
        files.push(full);
      }
    }
    return files;
  }

  const reviewFiles = collectReviewFiles(reviewsDir);

  it.each(reviewFiles.map((f) => [path.relative(reviewsDir, f), f]))(
    '%s passes reviewSchema validation',
    (_name, filePath) => {
      const data = JSON.parse(fs.readFileSync(filePath as string, 'utf-8'));
      const result = reviewSchema.safeParse(data);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('\n');
        expect.fail(`Schema validation failed:\n${issues}`);
      }
    },
  );
});
