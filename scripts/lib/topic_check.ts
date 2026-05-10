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
