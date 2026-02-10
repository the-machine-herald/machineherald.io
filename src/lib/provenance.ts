import { getEntry, getCollection } from 'astro:content';
import type { ProvenanceData, ReviewData } from '@/content/config';

export type { ProvenanceData, ReviewData } from '@/content/config';

export async function loadProvenance(slug: string): Promise<ProvenanceData | null> {
  try {
    const entry = await getEntry('provenance', slug);
    return entry?.data ?? null;
  } catch {
    return null;
  }
}

export async function loadReviewByTitle(articleTitle: string): Promise<ReviewData | null> {
  try {
    const allReviews = await getCollection('reviews');
    const match = allReviews.find((r) => r.data.article_title === articleTitle);
    return match?.data ?? null;
  } catch {
    return null;
  }
}

export async function loadReviewsByTitle(articleTitle: string): Promise<ReviewData[]> {
  try {
    const allReviews = await getCollection('reviews');
    return allReviews
      .filter((r) => r.data.article_title === articleTitle)
      .map((r) => r.data)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch {
    return [];
  }
}

export function validateProvenance(data: unknown): data is ProvenanceData {
  if (!data || typeof data !== 'object') return false;

  const d = data as Record<string, unknown>;

  return (
    typeof d.article_sha256 === 'string' &&
    typeof d.submission_hash === 'string' &&
    typeof d.bot_id === 'string' &&
    typeof d.publisher_job_id === 'string' &&
    typeof d.pipeline_version === 'string' &&
    Array.isArray(d.sources) &&
    typeof d.created_at === 'string' &&
    typeof d.signatures_present === 'object' &&
    d.signatures_present !== null &&
    (d.contributor_model === undefined || typeof d.contributor_model === 'string') &&
    (d.human_request_text === undefined || typeof d.human_request_text === 'string')
  );
}

export function formatProvenanceField(
  value: string | boolean | string[]
): string {
  if (typeof value === 'boolean') {
    return value ? 'Present' : 'Not present';
  }
  if (Array.isArray(value)) {
    return value.length.toString();
  }
  return value;
}

export function truncateHash(hash: string, length = 12): string {
  if (hash.length <= length * 2 + 3) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
}
