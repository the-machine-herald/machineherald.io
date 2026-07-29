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
 * Usage: npm run build && npm run verify:links
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const SITE_ORIGIN = 'https://machineherald.io';
const ALLOWLIST_PATH = resolve(process.cwd(), 'config/known_broken_links.txt');

const HREF_RE = /href="(\/[^"]*)"/g;
const LOC_RE = /<loc>([^<]+)<\/loc>/g;

/** Extensions served as-is; anything else is treated as a page route. */
const ASSET_RE = /\.(png|jpg|jpeg|svg|webp|ico|css|js|json|xml|txt|webmanifest)$/;

function walkHtml(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Strips hash/query/trailing slash so all lookups compare like-for-like. */
function cleanUrlPath(urlPath: string): string {
  return urlPath.split('#')[0]!.split('?')[0]!.replace(/\/+$/, '');
}

/** True when a (already-cleaned) urlPath maps to a file dist/ actually contains. */
function existsInDist(clean: string): boolean {
  if (clean === '') return existsSync(join(DIST, 'index.html'));

  const target = join(DIST, clean);
  if (ASSET_RE.test(clean)) return existsSync(target);
  return existsSync(join(target, 'index.html')) || existsSync(`${target}.html`);
}

interface RedirectRule {
  source: string;
  destination: string;
}

/** Parses a Cloudflare Pages `_redirects` file (source, destination, status). */
function parseRedirects(content: string): RedirectRule[] {
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
function matchRedirect(rules: RedirectRule[], clean: string): string | null {
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

function loadRedirects(): RedirectRule[] {
  const path = join(DIST, '_redirects');
  if (!existsSync(path)) return [];
  return parseRedirects(readFileSync(path, 'utf-8'));
}

function loadAllowlist(): Set<string> {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  const set = new Set<string>();
  for (const rawLine of readFileSync(ALLOWLIST_PATH, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    set.add(cleanUrlPath(line));
  }
  return set;
}

/** True when urlPath resolves directly, or via a redirect that itself resolves. */
function resolves(urlPath: string, redirects: RedirectRule[]): boolean {
  const clean = cleanUrlPath(urlPath);
  if (existsInDist(clean)) return true;
  const destination = matchRedirect(redirects, clean);
  if (destination === null) return false;
  return existsInDist(cleanUrlPath(destination));
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
function reportStaleAllowlistEntries(allowlist: Set<string>, redirects: RedirectRule[]): void {
  const stale = [...allowlist].filter((url) => resolves(url, redirects)).sort();
  if (stale.length === 0) return;
  const noun = stale.length === 1 ? 'entry' : 'entries';
  const verb = stale.length === 1 ? 'resolves' : 'resolve';
  console.warn(
    `⚠ ${stale.length} allowlist ${noun} in ${ALLOWLIST_PATH.slice(process.cwd().length + 1)} now ${verb} — remove:`,
  );
  for (const url of stale) console.warn(`  ${url}`);
}

function main(): void {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build` first');
    process.exit(1);
  }

  const redirects = loadRedirects();
  const allowlist = loadAllowlist();

  const pages = walkHtml(DIST);
  console.log(`Scanning ${pages.length} HTML files in dist/`);

  const brokenLinks = new Map<string, Set<string>>();
  for (const page of pages) {
    const html = readFileSync(page, 'utf-8');
    const from = page.slice(DIST.length + 1);
    for (const match of html.matchAll(HREF_RE)) {
      const url = match[1]!;
      if (url.startsWith('//')) continue; // protocol-relative external
      if (resolves(url, redirects)) continue;
      if (allowlist.has(cleanUrlPath(url))) continue;
      const sources = brokenLinks.get(url) ?? new Set<string>();
      sources.add(from);
      brokenLinks.set(url, sources);
    }
  }

  const brokenSitemap = new Map<string, Set<string>>();
  const sitemapPath = join(DIST, 'sitemap.xml');
  if (existsSync(sitemapPath)) {
    const xml = readFileSync(sitemapPath, 'utf-8');
    for (const match of xml.matchAll(LOC_RE)) {
      const loc = match[1]!;
      const url = loc.startsWith(SITE_ORIGIN) ? loc.slice(SITE_ORIGIN.length) : loc;
      if (!url.startsWith('/')) continue;
      if (resolves(url, redirects)) continue;
      if (allowlist.has(cleanUrlPath(url))) continue;
      brokenSitemap.set(url, new Set(['sitemap.xml']));
    }
  } else {
    console.error('✗ dist/sitemap.xml not found');
    process.exit(1);
  }

  const failures =
    report('internal links', brokenLinks) + report('sitemap URLs', brokenSitemap);

  reportStaleAllowlistEntries(allowlist, redirects);

  const fileCount = walkAll(DIST);
  console.log(`dist/ contains ${fileCount} files (Cloudflare Pages limit: 20000)`);

  process.exit(failures > 0 ? 1 : 0);
}

function walkAll(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += walkAll(join(dir, entry.name));
    else n += 1;
  }
  return n;
}

main();
