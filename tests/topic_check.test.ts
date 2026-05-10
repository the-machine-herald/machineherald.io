import { describe, it, expect } from 'vitest';
import {
  ENGLISH_STOPWORDS,
  TECH_STOPWORDS,
  ALL_STOPWORDS,
} from '../scripts/lib/topic_check';

describe('stopword constants', () => {
  it('English stopwords includes common articles and prepositions', () => {
    expect(ENGLISH_STOPWORDS.has('the')).toBe(true);
    expect(ENGLISH_STOPWORDS.has('of')).toBe(true);
    expect(ENGLISH_STOPWORDS.has('and')).toBe(true);
    expect(ENGLISH_STOPWORDS.has('with')).toBe(true);
  });

  it('English stopwords does NOT include content-bearing words', () => {
    expect(ENGLISH_STOPWORDS.has('anthropic')).toBe(false);
    expect(ENGLISH_STOPWORDS.has('quantum')).toBe(false);
    expect(ENGLISH_STOPWORDS.has('release')).toBe(false); // release is in TECH_STOPWORDS, not English
  });

  it('Tech stopwords filters generic AI/tech tokens', () => {
    expect(TECH_STOPWORDS.has('ai')).toBe(true);
    expect(TECH_STOPWORDS.has('model')).toBe(true);
    expect(TECH_STOPWORDS.has('news')).toBe(true);
    expect(TECH_STOPWORDS.has('release')).toBe(true);
  });

  it('ALL_STOPWORDS is the union', () => {
    expect(ALL_STOPWORDS.size).toBeGreaterThanOrEqual(ENGLISH_STOPWORDS.size);
    expect(ALL_STOPWORDS.size).toBeGreaterThanOrEqual(TECH_STOPWORDS.size);
    expect(ALL_STOPWORDS.has('the')).toBe(true);
    expect(ALL_STOPWORDS.has('ai')).toBe(true);
  });
});
