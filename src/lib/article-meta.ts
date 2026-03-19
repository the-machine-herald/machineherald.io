import type { CollectionEntry } from 'astro:content';
import { getCollection } from 'astro:content';
import type { z } from 'astro/zod';
import type { topicCategoryEnum } from './schemas';

export type TopicCategory = z.infer<typeof topicCategoryEnum>;

export interface ArticleWithMeta {
  article: CollectionEntry<'articles'>;
  meta: CollectionEntry<'article-meta'> | null;
}

/**
 * Join articles with their meta files by matching IDs.
 * Article ID: "2026-03/18-some-slug" → meta ID: "2026-03/18-some-slug"
 */
export async function getArticlesWithMeta(): Promise<ArticleWithMeta[]> {
  const [articles, metas] = await Promise.all([
    getCollection('articles'),
    getCollection('article-meta'),
  ]);

  const metaMap = new Map<string, CollectionEntry<'article-meta'>>();
  for (const meta of metas) {
    metaMap.set(meta.id, meta);
  }

  return articles.map((article) => ({
    article,
    meta: metaMap.get(article.id) ?? null,
  }));
}

export function getArticlesByTopic(
  articles: ArticleWithMeta[],
  topic: TopicCategory,
  limit?: number,
): ArticleWithMeta[] {
  const filtered = articles.filter((a) => a.meta?.data.topic === topic);
  return limit ? filtered.slice(0, limit) : filtered;
}

export function getFeaturedArticles(
  articles: ArticleWithMeta[],
  limit?: number,
): ArticleWithMeta[] {
  const filtered = articles.filter((a) => a.meta?.data.featured);
  return limit ? filtered.slice(0, limit) : filtered;
}

export function getAllTopics(
  articles: ArticleWithMeta[],
): Map<TopicCategory, number> {
  const counts = new Map<TopicCategory, number>();
  for (const { meta } of articles) {
    if (!meta) continue;
    const topic = meta.data.topic;
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

export function getTopicHierarchy(
  articles: ArticleWithMeta[],
): Map<TopicCategory, Set<string>> {
  const hierarchy = new Map<TopicCategory, Set<string>>();
  for (const { meta } of articles) {
    if (!meta) continue;
    const topic = meta.data.topic;
    if (!hierarchy.has(topic)) {
      hierarchy.set(topic, new Set());
    }
    hierarchy.get(topic)!.add(meta.data.subcategory);
  }
  return hierarchy;
}

export function topicSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function topicFromSlug(slug: string): TopicCategory | undefined {
  const topics: TopicCategory[] = [
    'AI & Machine Learning',
    'Cybersecurity',
    'Software Development',
    'Science & Research',
    'Space & Aerospace',
    'Energy & Climate',
    'Robotics & Automation',
    'Gaming & Entertainment',
    'Biotech & Medicine',
    'Hardware & Semiconductors',
    'Business & Industry',
    'Policy & Regulation',
  ];
  return topics.find((t) => topicSlug(t) === slug);
}

export function subcategorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export interface RelatedArticle {
  article: ArticleWithMeta;
  context: string;
  score: number;
}

/**
 * Find articles related to the given article.
 * Uses a layered approach:
 * 1. Curated related_articles from article-meta (highest priority)
 * 2. Same subcategory within the same topic
 * 3. Same topic, different subcategory
 * 4. Shared tags across any topic
 */
export function getRelatedArticles(
  currentArticle: ArticleWithMeta,
  allArticles: ArticleWithMeta[],
  limit: number = 4,
): RelatedArticle[] {
  const currentId = currentArticle.article.id;
  const currentMeta = currentArticle.meta?.data;
  const currentTags = new Set(
    currentArticle.article.data.tags.map((t) => t.toLowerCase()),
  );

  // Exclude the current article
  const candidates = allArticles.filter((a) => a.article.id !== currentId);

  // 1. Curated related articles (from article-meta)
  const curated: RelatedArticle[] = [];
  if (currentMeta?.related_articles) {
    for (const rel of currentMeta.related_articles) {
      const match = candidates.find((a) => a.article.id === rel.slug);
      if (match) {
        curated.push({ article: match, context: rel.context, score: 100 });
      }
    }
  }

  // If curated fills the limit, return early
  if (curated.length >= limit) {
    return curated.slice(0, limit);
  }

  // 2. Score remaining candidates
  const curatedIds = new Set(curated.map((c) => c.article.article.id));
  const scored: RelatedArticle[] = [];

  for (const candidate of candidates) {
    if (curatedIds.has(candidate.article.id)) continue;

    const candidateMeta = candidate.meta?.data;
    const candidateTags = new Set(
      candidate.article.data.tags.map((t) => t.toLowerCase()),
    );

    let score = 0;
    let context = '';

    // Same subcategory + same topic = strongest automatic match
    if (
      currentMeta &&
      candidateMeta &&
      currentMeta.topic === candidateMeta.topic &&
      currentMeta.subcategory === candidateMeta.subcategory
    ) {
      score += 30;
      context = `More in ${candidateMeta.subcategory}`;
    }
    // Same topic, different subcategory
    else if (
      currentMeta &&
      candidateMeta &&
      currentMeta.topic === candidateMeta.topic
    ) {
      score += 15;
      context = `Related ${candidateMeta.topic}`;
    }

    // Tag overlap
    const sharedTags: string[] = [];
    for (const tag of candidateTags) {
      if (currentTags.has(tag)) sharedTags.push(tag);
    }
    score += sharedTags.length * 5;
    if (!context && sharedTags.length > 0) {
      context = `Also tagged: ${sharedTags.slice(0, 2).join(', ')}`;
    }

    // Recency bonus: articles closer in time get a small boost
    const daysDiff = Math.abs(
      (currentArticle.article.data.date.getTime() -
        candidate.article.data.date.getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (daysDiff <= 7) score += 3;
    else if (daysDiff <= 30) score += 1;

    if (score > 0) {
      scored.push({ article: candidate, context, score });
    }
  }

  // Sort by score descending, then by date descending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      b.article.article.data.date.getTime() -
      a.article.article.data.date.getTime()
    );
  });

  return [...curated, ...scored].slice(0, limit);
}
