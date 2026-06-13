/**
 * Canonical article-slug derivation — the SINGLE source of truth shared by the
 * publish pipeline (generate_article_from_submission.ts) and the `npm run slug`
 * helper used during editorial review.
 *
 * The slug is what the published article markdown, provenance record,
 * article-meta, and corrections files are all keyed on. Reviewers create
 * article-meta and corrections files BEFORE the article exists on disk, so they
 * must name those files with the exact slug the pipeline will later produce.
 * Predicting it by hand is error-prone: `slugify` strips every character outside
 * `[A-Za-z0-9_\s-]`, so "1.38" collapses to "138" and "$3.5" to "35". Use
 * `npm run slug -- <submission.json>` to get the exact value instead of guessing.
 */

export interface SluggableSubmission {
  timestamp: string;
  article: { title: string };
}

/**
 * Lowercase, strip punctuation (anything outside word chars / whitespace /
 * hyphen), collapse whitespace and repeated hyphens to single hyphens.
 *
 * NOTE: this removes `.`, `$`, `'`, `:`, `,` etc. rather than replacing them, so
 * "v1.38" -> "v138" and "$3.5B" -> "35b". Kept verbatim for backwards
 * compatibility — changing it would alter the slugs (and URLs) of all future
 * articles and break consistency with the existing archive.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/** `YYYY-MM` monthly folder derived from the submission timestamp (UTC). */
export function getMonthFolder(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Full canonical slug, e.g. `2026-06/13-weaviate-138-promotes-its-disk-based-...`.
 * Format: `<YYYY-MM>/<DD>-<slugified-title>` (day is UTC, zero-padded).
 */
export function generateSlug(submission: SluggableSubmission): string {
  const date = new Date(submission.timestamp);
  const monthFolder = getMonthFolder(submission.timestamp);
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${monthFolder}/${day}-${slugify(submission.article.title)}`;
}
