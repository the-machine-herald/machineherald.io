import { describe, it, expect } from 'vitest';
import {
  MIN_SIGNAL_ARTICLES,
  MIN_SOURCE_ARTICLES,
  buildSignalIndex,
  buildSourceIndex,
  type TaxonomyArticle,
} from '../src/lib/taxonomy';

function article(
  id: string,
  tags: string[],
  sources: string[] = [],
  draft = false
): TaxonomyArticle {
  return { id, data: { tags, sources, draft } };
}

/** n articles all carrying `tag`, ids prefixed to keep them distinct. */
function withTag(tag: string, n: number, prefix = 't'): TaxonomyArticle[] {
  return Array.from({ length: n }, (_, i) => article(`${prefix}-${i}`, [tag]));
}

describe('thresholds', () => {
  it('are both 5', () => {
    expect(MIN_SIGNAL_ARTICLES).toBe(5);
    expect(MIN_SOURCE_ARTICLES).toBe(5);
  });
});

describe('buildSignalIndex', () => {
  it('includes a tag that meets the threshold exactly', () => {
    const index = buildSignalIndex(withTag('Quantum Computing', 5));
    expect([...index.keys()]).toEqual(['quantum-computing']);
    expect(index.get('quantum-computing')?.articles).toHaveLength(5);
    expect(index.get('quantum-computing')?.signal).toBe('Quantum Computing');
  });

  it('excludes a tag one article below the threshold', () => {
    const index = buildSignalIndex(withTag('Quantum Computing', 4));
    expect(index.size).toBe(0);
  });

  it('does not count draft articles toward the threshold', () => {
    const articles = [
      ...withTag('Robotics', 4),
      article('draft-1', ['Robotics'], [], true),
    ];
    expect(buildSignalIndex(articles).size).toBe(0);
  });

  it('merges tag spellings that share a slug', () => {
    const articles = [
      ...withTag('GPT-5.4', 3, 'a'),
      ...withTag('GPT 54', 2, 'b'),
    ];
    const index = buildSignalIndex(articles);
    expect(index.size).toBe(1);
    expect(index.get('gpt-54')?.articles).toHaveLength(5);
  });

  it('counts an article once even if two of its tags share a slug', () => {
    const articles = [
      { id: 'dup', data: { tags: ['GPT-5.4', 'GPT 54'], sources: [], draft: false } },
      ...withTag('GPT-5.4', 4, 'c'),
    ];
    const index = buildSignalIndex(articles);
    expect(index.get('gpt-54')?.articles).toHaveLength(5);
  });

  it('honours an explicit threshold override', () => {
    const index = buildSignalIndex(withTag('Robotics', 2), 2);
    expect(index.size).toBe(1);
  });

  it('returns an empty index for no articles', () => {
    expect(buildSignalIndex([]).size).toBe(0);
  });
});

describe('buildSourceIndex', () => {
  const src = (n: number, host: string) =>
    Array.from({ length: n }, (_, i) =>
      article(`s-${host}-${i}`, [], [`https://${host}/story-${i}`])
    );

  it('includes a domain that meets the threshold', () => {
    const index = buildSourceIndex(src(5, 'reuters.com'));
    expect([...index.keys()]).toEqual(['reuters.com']);
    expect(index.get('reuters.com')?.articles).toHaveLength(5);
  });

  it('excludes a domain below the threshold', () => {
    expect(buildSourceIndex(src(4, 'reuters.com')).size).toBe(0);
  });

  it('strips the www prefix so both spellings share a group', () => {
    const articles = [
      ...src(3, 'reuters.com'),
      article('w-1', [], ['https://www.reuters.com/a']),
      article('w-2', [], ['https://www.reuters.com/b']),
    ];
    const index = buildSourceIndex(articles);
    expect(index.size).toBe(1);
    expect(index.get('reuters.com')?.articles).toHaveLength(5);
  });

  it('counts an article once when it cites the same domain twice', () => {
    const articles = [
      article('multi', [], ['https://reuters.com/a', 'https://reuters.com/b']),
      ...src(4, 'reuters.com'),
    ];
    expect(buildSourceIndex(articles).get('reuters.com')?.articles).toHaveLength(5);
  });

  it('does not count draft articles toward the threshold', () => {
    const articles = [
      ...src(4, 'reuters.com'),
      article('draft-s', [], ['https://reuters.com/x'], true),
    ];
    expect(buildSourceIndex(articles).size).toBe(0);
  });
});
