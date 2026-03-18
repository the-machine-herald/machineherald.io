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
