/**
 * Topic-check helpers.
 *
 * Pure-logic utilities — stopwords, tokenize, jaccard, scoreCandidate,
 * walkArchive, parseOpenPRs — consumed by scripts/check_topic.ts to detect
 * whether a proposed article topic is too similar to recently published or
 * in-flight work.
 */

// scripts/lib/topic_check.ts

/**
 * Closed-list English stopwords for keyword extraction.
 * Reviewable here rather than hidden inside a regex.
 */
export const ENGLISH_STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'must',
  'shall', 'should', 'this', 'that', 'these', 'those', 'it', 'its', 'itself',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'but', 'or', 'and', 'if', 'then', 'else', 'while',
  'also', 'after', 'before', 'between', 'into', 'through', 'during', 'above',
  'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
  'here', 'there',
]);

/**
 * Tech-domain stopwords that recur in titles without distinguishing topics.
 * Tunable. Add tokens here when you observe Jaccard inflation from generic terms.
 */
export const TECH_STOPWORDS = new Set<string>([
  'ai', 'model', 'news', 'tech', 'company', 'data', 'system', 'new', 'update',
  'release', 'platform', 'service', 'products', 'product', 'today', 'week',
  'month', 'announces', 'announced', 'announcement',
]);

export const ALL_STOPWORDS = new Set<string>([
  ...ENGLISH_STOPWORDS,
  ...TECH_STOPWORDS,
]);

/**
 * Extract content-bearing tokens from a title (and optional tags).
 *
 * Rules:
 *  - lowercase
 *  - replace non-alphanumeric with whitespace, split, dedupe
 *  - drop tokens whose length < 3
 *  - drop pure-numeric tokens (/^\d+$/)
 *  - drop English + tech stopwords
 */
export function tokenize(title: string, tags: string[] = []): Set<string> {
  const combined = [title, ...tags].join(' ').toLowerCase();
  const raw = combined.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const result = new Set<string>();
  for (const tok of raw) {
    if (tok.length < 3) continue;
    if (/^\d+$/.test(tok)) continue;
    if (ALL_STOPWORDS.has(tok)) continue;
    result.add(tok);
  }
  return result;
}

/**
 * Jaccard similarity coefficient: |A ∩ B| / |A ∪ B|.
 * Returns 0 when both sets are empty (avoids NaN).
 */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export interface Candidate {
  title: string;
  tags?: string[];
}

export type CorpusItemType = 'open_pr' | 'published_article';

export interface CorpusItem {
  type: CorpusItemType;
  ref: string;          // e.g. "PR #1192" or "2026-05/08-anthropic-leases-..."
  title: string;
  tags?: string[];
}

export interface Neighbor {
  type: CorpusItemType;
  ref: string;
  title: string;
  jaccard: number;
}

export type Verdict = 'clear' | 'collision' | 'empty_candidate';

export interface ScoreResult {
  verdict: Verdict;
  max_jaccard: number;
  threshold: number;
  collision_with?: Neighbor;
  neighbors: Neighbor[];      // top 3 by Jaccard, descending
  candidate_keywords: string[];
}

const TOP_N_NEIGHBORS = 3;

/**
 * Score a candidate topic against a corpus of existing items
 * (open PRs and/or published articles). Returns:
 *   - verdict: collision if max Jaccard ≥ threshold; clear otherwise
 *   - empty_candidate if the candidate produces zero content-bearing keywords
 *   - top-3 neighbors regardless of verdict (for diagnostics)
 */
export function scoreCandidate(
  candidate: Candidate,
  corpus: CorpusItem[],
  threshold: number,
): ScoreResult {
  const candidateSet = tokenize(candidate.title, candidate.tags ?? []);
  const candidate_keywords = [...candidateSet].sort();

  if (candidateSet.size === 0) {
    return {
      verdict: 'empty_candidate',
      max_jaccard: 0,
      threshold,
      neighbors: [],
      candidate_keywords,
    };
  }

  const scored: Neighbor[] = corpus.map(item => ({
    type: item.type,
    ref: item.ref,
    title: item.title,
    jaccard: jaccard(candidateSet, tokenize(item.title, item.tags ?? [])),
  }));

  scored.sort((a, b) => b.jaccard - a.jaccard);
  const neighbors = scored.slice(0, TOP_N_NEIGHBORS);
  const top = scored[0];
  const max_jaccard = top?.jaccard ?? 0;

  if (top && max_jaccard >= threshold) {
    return {
      verdict: 'collision',
      max_jaccard,
      threshold,
      collision_with: top,
      neighbors,
      candidate_keywords,
    };
  }

  return {
    verdict: 'clear',
    max_jaccard,
    threshold,
    neighbors,
    candidate_keywords,
  };
}
