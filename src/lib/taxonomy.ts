import { slugify, extractDomain } from './utils';

/**
 * Minimum number of published articles a tag or source domain needs before it
 * gets its own generated page.
 *
 * Below this, a taxonomy page lists one or two articles — thin content that
 * inflates the deployment's file count (Cloudflare Pages caps a deployment at
 * 20,000 files) without helping readers navigate. Tags below the threshold stay
 * visible on articles, they just do not link anywhere.
 */
export const MIN_SIGNAL_ARTICLES = 5;
export const MIN_SOURCE_ARTICLES = 5;

/**
 * The shape these functions need from an article. `CollectionEntry<'articles'>`
 * satisfies it structurally, so pages can pass real entries and get real entries
 * back via the generic parameter — while this module stays free of any runtime
 * `astro:content` import and therefore unit-testable.
 */
export interface TaxonomyArticle {
  id: string;
  data: {
    tags: string[];
    sources: string[];
    draft?: boolean;
  };
}

export interface SignalGroup<T> {
  /** Display label: the first tag spelling seen for this slug. */
  signal: string;
  slug: string;
  articles: T[];
}

export interface SourceGroup<T> {
  domain: string;
  articles: T[];
}

/**
 * Groups published articles by tag slug, keeping only groups at or above the
 * threshold. Keyed by slug rather than raw tag so two spellings that slugify
 * identically resolve to one page, matching the URL space.
 */
export function buildSignalIndex<T extends TaxonomyArticle>(
  articles: T[],
  min: number = MIN_SIGNAL_ARTICLES
): Map<string, SignalGroup<T>> {
  const groups = new Map<string, SignalGroup<T>>();
  const seen = new Map<string, Set<string>>();

  for (const article of articles) {
    if (article.data.draft) continue;
    for (const tag of article.data.tags) {
      const slug = slugify(tag);
      if (slug === '') continue;

      let group = groups.get(slug);
      if (!group) {
        group = { signal: tag, slug, articles: [] };
        groups.set(slug, group);
        seen.set(slug, new Set());
      }

      const ids = seen.get(slug)!;
      if (ids.has(article.id)) continue;
      ids.add(article.id);
      group.articles.push(article);
    }
  }

  for (const [slug, group] of groups) {
    if (group.articles.length < min) groups.delete(slug);
  }
  return groups;
}

/**
 * Groups published articles by source domain, keeping only groups at or above
 * the threshold. An article citing a domain more than once is counted once.
 */
export function buildSourceIndex<T extends TaxonomyArticle>(
  articles: T[],
  min: number = MIN_SOURCE_ARTICLES
): Map<string, SourceGroup<T>> {
  const groups = new Map<string, SourceGroup<T>>();
  const seen = new Map<string, Set<string>>();

  for (const article of articles) {
    if (article.data.draft) continue;
    for (const url of article.data.sources) {
      const domain = extractDomain(url);
      if (domain === '') continue;

      let group = groups.get(domain);
      if (!group) {
        group = { domain, articles: [] };
        groups.set(domain, group);
        seen.set(domain, new Set());
      }

      const ids = seen.get(domain)!;
      if (ids.has(article.id)) continue;
      ids.add(article.id);
      group.articles.push(article);
    }
  }

  for (const [domain, group] of groups) {
    if (group.articles.length < min) groups.delete(domain);
  }
  return groups;
}
