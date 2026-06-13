/**
 * Print the canonical article slug the publish pipeline will produce for a
 * submission — so editorial review can name article-meta and corrections files
 * with the exact slug instead of predicting `slugify`'s punctuation handling.
 *
 * Usage:
 *   npm run slug -- src/content/submissions/2026-06/2026-06-13T...json
 *
 * Output (stdout, single line):
 *   2026-06/13-weaviate-138-promotes-its-disk-based-hfresh-vector-index-to-ga-...
 *
 * The slug has the form `<YYYY-MM>/<DD>-<slugified-title>`. The published files are:
 *   src/content/articles/<slug>.md
 *   src/content/provenance/<slug>.json
 *   src/content/article-meta/<slug>.json      (basename without the month folder)
 *   src/content/corrections/<slug>.json       (basename; article_slug field = <slug>)
 *
 * Exit codes: 0 ok · 1 bad/missing input.
 */
import fs from 'node:fs';
import { generateSlug, type SluggableSubmission } from './lib/slug';

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  fail('no submission file given. Usage: npm run slug -- <submission.json>');
}
if (!fs.existsSync(file)) {
  fail(`submission file not found: ${file}`);
}

let parsed: unknown;
try {
  parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
} catch (err) {
  fail(`could not parse JSON: ${err instanceof Error ? err.message : String(err)}`);
}

const sub = parsed as Partial<SluggableSubmission>;
if (!sub || typeof sub.timestamp !== 'string' || !sub.article || typeof sub.article.title !== 'string') {
  fail('submission JSON missing required fields (timestamp, article.title)');
}

process.stdout.write(generateSlug(sub as SluggableSubmission) + '\n');
