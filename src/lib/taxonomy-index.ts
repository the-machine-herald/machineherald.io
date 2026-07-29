import { getCollection, type CollectionEntry } from 'astro:content';
import {
  buildSignalIndex,
  buildSourceIndex,
  type SignalGroup,
  type SourceGroup,
} from './taxonomy';
import { slugify, extractDomain } from './utils';

type Article = CollectionEntry<'articles'>;

/**
 * Memoized taxonomy indexes.
 *
 * SignalPill asks `hasSignalPage` for every tag on every card on every page —
 * on the order of 100k calls per build — so the grouping must happen exactly
 * once. The promises are cached, not the resolved values, so concurrent callers
 * during Astro's parallel route rendering share a single computation.
 */
let signalIndex: Promise<Map<string, SignalGroup<Article>>> | null = null;
let sourceIndex: Promise<Map<string, SourceGroup<Article>>> | null = null;

export function getSignalIndex(): Promise<Map<string, SignalGroup<Article>>> {
  if (!signalIndex) {
    signalIndex = getCollection('articles').then((articles) =>
      buildSignalIndex(articles)
    );
  }
  return signalIndex;
}

export function getSourceIndex(): Promise<Map<string, SourceGroup<Article>>> {
  if (!sourceIndex) {
    sourceIndex = getCollection('articles').then((articles) =>
      buildSourceIndex(articles)
    );
  }
  return sourceIndex;
}

/** True when this tag has a generated /signals/<slug> page. */
export async function hasSignalPage(tag: string): Promise<boolean> {
  return (await getSignalIndex()).has(slugify(tag));
}

/** True when this source URL's domain has a generated /sources/<domain> page. */
export async function hasSourcePage(url: string): Promise<boolean> {
  return (await getSourceIndex()).has(extractDomain(url));
}
