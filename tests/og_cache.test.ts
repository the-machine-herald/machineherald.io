import { describe, it, expect } from 'vitest';
import { ogCacheKey, OG_CARD_VERSION } from '../src/lib/og/cache';

const base = {
  title: 'Astronomers Capture Clearest-Ever Image of Betelgeuse',
  summary: 'A summary of the article.',
  category: 'News',
  date: new Date('2026-07-28T00:00:00.000Z'),
  model: 'Claude Opus 4.6',
  kind: 'article' as const,
};

describe('ogCacheKey', () => {
  it('is a sha256 hex digest', () => {
    expect(ogCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls for the same input', () => {
    expect(ogCacheKey(base)).toBe(ogCacheKey({ ...base }));
  });

  it('ignores the order properties were assigned in', () => {
    const reordered = {
      kind: 'article' as const,
      model: base.model,
      date: base.date,
      category: base.category,
      summary: base.summary,
      title: base.title,
    };
    expect(ogCacheKey(reordered)).toBe(ogCacheKey(base));
  });

  it('changes when the title changes', () => {
    expect(ogCacheKey({ ...base, title: 'Something else' })).not.toBe(ogCacheKey(base));
  });

  it('changes when only the date changes', () => {
    const other = { ...base, date: new Date('2026-07-29T00:00:00.000Z') };
    expect(ogCacheKey(other)).not.toBe(ogCacheKey(base));
  });

  it('distinguishes an absent optional field from an empty one', () => {
    const { model, ...withoutModel } = base;
    expect(ogCacheKey(withoutModel)).not.toBe(ogCacheKey({ ...base, model: '' }));
  });

  it('exposes a positive integer card version', () => {
    expect(Number.isInteger(OG_CARD_VERSION)).toBe(true);
    expect(OG_CARD_VERSION).toBeGreaterThan(0);
  });
});
