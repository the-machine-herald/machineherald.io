import { describe, it, expect } from 'vitest';
import {
  ENGLISH_STOPWORDS,
  TECH_STOPWORDS,
  ALL_STOPWORDS,
  tokenize,
  jaccard,
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

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Anthropic, OpenAI: a deal!')).toEqual(
      new Set(['anthropic', 'openai', 'deal'])
    );
  });

  it('drops English stopwords', () => {
    const result = tokenize('The quick brown fox jumps over the lazy dog');
    expect(result.has('the')).toBe(false);
    expect(result.has('over')).toBe(false);
    expect(result.has('quick')).toBe(true);
    expect(result.has('brown')).toBe(true);
  });

  it('drops tech-domain stopwords', () => {
    const result = tokenize('AI Model Release News');
    expect(result.has('ai')).toBe(false);
    expect(result.has('model')).toBe(false);
    expect(result.has('release')).toBe(false);
    expect(result.has('news')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('drops tokens shorter than 3 chars', () => {
    const result = tokenize('AI is a 5G OS');
    expect(result.has('5g')).toBe(false);
    expect(result.has('os')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('drops pure-numeric tokens', () => {
    const result = tokenize('Apache 2.4.67 patches CVE 23918');
    expect(result.has('apache')).toBe(true);
    expect(result.has('patches')).toBe(true);
    expect(result.has('cve')).toBe(true);
    expect(result.has('23918')).toBe(false);
    expect(result.has('2')).toBe(false);
    expect(result.has('4')).toBe(false);
    expect(result.has('67')).toBe(false);
  });

  it('keeps mixed alphanumeric tokens (version-like)', () => {
    const result = tokenize('GPT-5.5 and ZAYA1');
    expect(result.has('gpt')).toBe(true);
    expect(result.has('zaya1')).toBe(true);
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual(new Set<string>());
    expect(tokenize('   ')).toEqual(new Set<string>());
  });

  it('combines title and tags input', () => {
    const result = tokenize('Anthropic deal', ['claude', 'spacex']);
    expect(result).toEqual(new Set(['anthropic', 'deal', 'claude', 'spacex']));
  });
});

describe('jaccard', () => {
  it('identical sets → 1.0', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccard(s, s)).toBe(1);
  });

  it('disjoint sets → 0.0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
  });

  it('half overlap', () => {
    // A ∩ B = {b}, A ∪ B = {a,b,c} → 1/3
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });

  it('one set subset of the other', () => {
    // {a,b} ∩ {a,b,c} = {a,b}, ∪ = {a,b,c} → 2/3
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b', 'c']))).toBeCloseTo(2 / 3);
  });

  it('two empty sets → 0 (avoid NaN)', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('one empty + one populated → 0', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});
