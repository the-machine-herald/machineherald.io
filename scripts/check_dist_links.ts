/**
 * Post-build link integrity check.
 *
 * Walks every generated HTML file plus sitemap.xml and asserts that each
 * internal URL resolves to a file in dist/. Guards against two failure modes:
 * a component linking to a taxonomy page that is no longer generated, and the
 * sitemap advertising a URL that was never built.
 *
 * Two escape hatches keep the check honest instead of just permissive:
 *
 * - dist/_redirects (Cloudflare Pages redirect rules): a URL counts as
 *   resolving if it matches a rule AND the rule's substituted destination
 *   itself resolves in dist/. A rule pointing at a target that doesn't exist
 *   still fails — the redirect must actually land somewhere real.
 * - config/known_broken_links.txt: an explicit, commented allowlist for the
 *   handful of dead links baked into signed article bodies that cannot be
 *   edited. Allowlisted URLs never fail the build, but if one starts
 *   resolving (directly or via a redirect) the check prints a warning asking
 *   for the now-stale entry to be removed — it never fails on that either.
 *
 * Every function below is exported and takes the paths it needs (dist,
 * origin, allowlist path) as explicit arguments rather than closing over the
 * module-level DIST/SITE_ORIGIN/ALLOWLIST_PATH constants, specifically so
 * tests/check_dist_links.test.ts can drive them against temp fixtures instead
 * of the real dist/. `main()` is guarded to run only when this file is
 * executed directly, not on import.
 *
 * Usage: npm run build && npm run verify:links
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE } from '../src/lib/seo';

const DIST = resolve(process.cwd(), 'dist');
/**
 * The origin sitemap <loc> entries are prefixed with. Derived from the same
 * SITE.url that src/pages/sitemap.xml.ts uses to build those entries, so this
 * check and the sitemap generator can never drift apart into two different
 * hardcoded values — if SITE.url ever changes (trailing slash, www., a
 * staging origin), both sides move together automatically.
 */
const SITE_ORIGIN = SITE.url;
const ALLOWLIST_PATH = resolve(process.cwd(), 'config/known_broken_links.txt');

const HREF_RE = /href="(\/[^"]*)"/g;
const LOC_RE = /<loc>([^<]+)<\/loc>/g;

/** Extensions served as-is; anything else is treated as a page route. */
const ASSET_RE = /\.(png|jpg|jpeg|svg|webp|ico|css|js|json|xml|txt|webmanifest)$/;

export function walkHtml(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

export function walkAll(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += walkAll(join(dir, entry.name));
    else n += 1;
  }
  return n;
}

/** Strips hash/query/trailing slash so all lookups compare like-for-like. */
export function cleanUrlPath(urlPath: string): string {
  return urlPath.split('#')[0]!.split('?')[0]!.replace(/\/+$/, '');
}

/** True when a (already-cleaned) urlPath maps to a file dist/ actually contains. */
export function existsInDist(dist: string, clean: string): boolean {
  if (clean === '') return existsSync(join(dist, 'index.html'));

  const target = join(dist, clean);
  if (ASSET_RE.test(clean)) return existsSync(target);
  return existsSync(join(target, 'index.html')) || existsSync(`${target}.html`);
}

export interface RedirectRule {
  source: string;
  destination: string;
}

/** Parses a Cloudflare Pages `_redirects` file (source, destination, status). */
export function parseRedirects(content: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const source = parts[0];
    const destination = parts[1];
    if (!source || !destination) continue;
    rules.push({ source, destination });
  }
  return rules;
}

/**
 * Matches a cleaned urlPath against `:placeholder` redirect rules and returns
 * the substituted destination, or null if no rule matches. Placeholders
 * match exactly one path segment, so rule and URL must have the same segment
 * count — this is what keeps a two-segment rule from matching one-segment
 * pagination routes like /articles/2.
 */
export function matchRedirect(rules: RedirectRule[], clean: string): string | null {
  const urlSegments = clean.split('/').filter((s) => s !== '');
  for (const rule of rules) {
    const srcSegments = rule.source.split('/').filter((s) => s !== '');
    if (srcSegments.length !== urlSegments.length) continue;

    const captures = new Map<string, string>();
    let matched = true;
    for (let i = 0; i < srcSegments.length; i++) {
      const srcSeg = srcSegments[i]!;
      const urlSeg = urlSegments[i]!;
      if (srcSeg.startsWith(':')) {
        captures.set(srcSeg.slice(1), urlSeg);
      } else if (srcSeg !== urlSeg) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    const destSegments = rule.destination.split('/').filter((s) => s !== '');
    const resolvedSegments = destSegments.map((seg) =>
      seg.startsWith(':') ? (captures.get(seg.slice(1)) ?? seg) : seg,
    );
    return `/${resolvedSegments.join('/')}`;
  }
  return null;
}

export function loadRedirects(dist: string): RedirectRule[] {
  const path = join(dist, '_redirects');
  if (!existsSync(path)) return [];
  return parseRedirects(readFileSync(path, 'utf-8'));
}

export function loadAllowlist(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const set = new Set<string>();
  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    set.add(cleanUrlPath(line));
  }
  return set;
}

/** True when urlPath resolves directly, or via a redirect that itself resolves. */
export function resolves(dist: string, urlPath: string, redirects: RedirectRule[]): boolean {
  const clean = cleanUrlPath(urlPath);
  if (existsInDist(dist, clean)) return true;
  const destination = matchRedirect(redirects, clean);
  if (destination === null) return false;
  return existsInDist(dist, cleanUrlPath(destination));
}

export type LinkStatus = 'ok' | 'allowlisted' | 'broken';

/**
 * The single per-URL verdict used by both the HTML-href scan and the sitemap
 * scan, so the two can never apply different rules for what counts as
 * resolving or allowlisted. Allowlist matching is an exact Set lookup against
 * the cleaned path — never a prefix/startsWith test — so an allowlist entry
 * only ever excuses the exact dead link it documents.
 */
export function checkUrl(
  dist: string,
  urlPath: string,
  redirects: RedirectRule[],
  allowlist: Set<string>,
): LinkStatus {
  if (resolves(dist, urlPath, redirects)) return 'ok';
  if (allowlist.has(cleanUrlPath(urlPath))) return 'allowlisted';
  return 'broken';
}

export function checkHtmlLinks(
  pages: string[],
  dist: string,
  redirects: RedirectRule[],
  allowlist: Set<string>,
): Map<string, Set<string>> {
  const broken = new Map<string, Set<string>>();
  for (const page of pages) {
    const html = readFileSync(page, 'utf-8');
    const from = page.slice(dist.length + 1);
    for (const match of html.matchAll(HREF_RE)) {
      const url = match[1]!;
      if (url.startsWith('//')) continue; // protocol-relative external
      if (checkUrl(dist, url, redirects, allowlist) !== 'broken') continue;
      const sources = broken.get(url) ?? new Set<string>();
      sources.add(from);
      broken.set(url, sources);
    }
  }
  return broken;
}

export interface SitemapCheckResult {
  broken: Map<string, Set<string>>;
  /** Number of <loc> entries that were actually run through checkUrl(). */
  checked: number;
}

/**
 * Checks every <loc> in a sitemap.xml body. A <loc> is checkable only if it is
 * origin-relative (starts with "/") or prefixed with `origin` — anything else
 * means `origin` and the sitemap have drifted apart, which used to be handled
 * by silently `continue`-ing past the entry. That let the whole check report
 * green having verified nothing. Now such an entry is recorded in `broken`
 * (naming the offending <loc> verbatim) instead of skipped, and is NOT counted
 * in `checked` — it was never actually tested against dist/. Callers must
 * additionally treat `checked === 0` as a hard failure: a sitemap that yields
 * no checkable URLs (empty file, or every entry origin-mismatched) verified
 * nothing and must not be reported as passing.
 */
export function checkSitemapUrls(
  xml: string,
  dist: string,
  origin: string,
  redirects: RedirectRule[],
  allowlist: Set<string>,
): SitemapCheckResult {
  const broken = new Map<string, Set<string>>();
  let checked = 0;
  for (const match of xml.matchAll(LOC_RE)) {
    const loc = match[1]!;
    let url: string;
    if (loc.startsWith(origin)) {
      url = loc.slice(origin.length);
    } else if (loc.startsWith('/')) {
      url = loc;
    } else {
      broken.set(loc, new Set([`sitemap.xml (origin mismatch: expected prefix "${origin}")`]));
      continue;
    }
    checked++;
    if (checkUrl(dist, url, redirects, allowlist) !== 'broken') continue;
    broken.set(url, new Set(['sitemap.xml']));
  }
  return { broken, checked };
}

function report(label: string, broken: Map<string, Set<string>>): number {
  if (broken.size === 0) {
    console.log(`✓ ${label}: all targets resolve`);
    return 0;
  }
  console.error(`✗ ${label}: ${broken.size} unresolved target(s)`);
  for (const [url, sources] of [...broken].sort()) {
    const list = [...sources].slice(0, 3);
    const more = sources.size > 3 ? ` (+${sources.size - 3} more)` : '';
    console.error(`  ${url}\n      from: ${list.join(', ')}${more}`);
  }
  return broken.size;
}

/** Warns about allowlist entries that now resolve and should be deleted. Never fails. */
function reportStaleAllowlistEntries(
  dist: string,
  allowlist: Set<string>,
  redirects: RedirectRule[],
): void {
  const stale = [...allowlist].filter((url) => resolves(dist, url, redirects)).sort();
  if (stale.length === 0) return;
  const noun = stale.length === 1 ? 'entry' : 'entries';
  const verb = stale.length === 1 ? 'resolves' : 'resolve';
  console.warn(
    `⚠ ${stale.length} allowlist ${noun} in ${ALLOWLIST_PATH.slice(process.cwd().length + 1)} now ${verb} — remove:`,
  );
  for (const url of stale) console.warn(`  ${url}`);
}

export function main(): void {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build` first');
    process.exit(1);
  }

  const redirects = loadRedirects(DIST);
  const allowlist = loadAllowlist(ALLOWLIST_PATH);

  const pages = walkHtml(DIST);
  console.log(`Scanning ${pages.length} HTML files in dist/`);

  const brokenLinks = checkHtmlLinks(pages, DIST, redirects, allowlist);

  const sitemapPath = join(DIST, 'sitemap.xml');
  if (!existsSync(sitemapPath)) {
    console.error('✗ dist/sitemap.xml not found');
    process.exit(1);
  }
  const xml = readFileSync(sitemapPath, 'utf-8');
  const { broken: brokenSitemap, checked: sitemapChecked } = checkSitemapUrls(
    xml,
    DIST,
    SITE_ORIGIN,
    redirects,
    allowlist,
  );
  console.log(
    `Checked ${sitemapChecked} sitemap <loc> entries against dist/ (expected origin: ${SITE_ORIGIN})`,
  );

  let sitemapFailures: number;
  if (sitemapChecked === 0) {
    // Never let a zero-coverage run print the "all targets resolve" success
    // line — report() alone can't distinguish "checked N, 0 broken" from
    // "checked nothing", so that assertion has to live here.
    console.error(
      `✗ sitemap URLs: 0 <loc> entries were checkable — a sitemap that verifies nothing is a failure, not a pass`,
    );
    sitemapFailures = brokenSitemap.size > 0 ? report('sitemap URLs', brokenSitemap) : 1;
  } else {
    sitemapFailures = report('sitemap URLs', brokenSitemap);
  }

  const failures = report('internal links', brokenLinks) + sitemapFailures;

  reportStaleAllowlistEntries(DIST, allowlist, redirects);

  const fileCount = walkAll(DIST);
  console.log(`dist/ contains ${fileCount} files (Cloudflare Pages limit: 20000)`);

  process.exit(failures > 0 ? 1 : 0);
}

// Only run when this file is the process entrypoint (`tsx scripts/check_dist_links.ts`),
// not when it's imported — e.g. by tests/check_dist_links.test.ts.
//
// Compared via pathToFileURL rather than a `file://${process.argv[1]}` template
// literal: import.meta.url percent-encodes characters like spaces and non-ASCII
// bytes, and resolves symlinks, so the naive string comparison silently fails
// (main() never runs, script exits 0 having checked nothing) whenever the
// script's path contains such characters or is reached through a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
