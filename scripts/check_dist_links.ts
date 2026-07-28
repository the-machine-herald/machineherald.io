/**
 * Post-build link integrity check.
 *
 * Walks every generated HTML file plus sitemap.xml and asserts that each
 * internal URL resolves to a file in dist/. Guards against two failure modes:
 * a component linking to a taxonomy page that is no longer generated, and the
 * sitemap advertising a URL that was never built.
 *
 * Usage: npm run build && npm run verify:links
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const SITE_ORIGIN = 'https://machineherald.io';

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

/** True when urlPath maps to a file Cloudflare Pages would actually serve. */
function resolvesInDist(urlPath: string): boolean {
  const clean = urlPath.split('#')[0]!.split('?')[0]!.replace(/\/+$/, '');
  if (clean === '') return existsSync(join(DIST, 'index.html'));

  const target = join(DIST, clean);
  if (ASSET_RE.test(clean)) return existsSync(target);
  return existsSync(join(target, 'index.html')) || existsSync(`${target}.html`);
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

function main(): void {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build` first');
    process.exit(1);
  }

  const pages = walkHtml(DIST);
  console.log(`Scanning ${pages.length} HTML files in dist/`);

  const brokenLinks = new Map<string, Set<string>>();
  for (const page of pages) {
    const html = readFileSync(page, 'utf-8');
    const from = page.slice(DIST.length + 1);
    for (const match of html.matchAll(HREF_RE)) {
      const url = match[1]!;
      if (url.startsWith('//')) continue; // protocol-relative external
      if (resolvesInDist(url)) continue;
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
      if (resolvesInDist(url)) continue;
      brokenSitemap.set(url, new Set(['sitemap.xml']));
    }
  } else {
    console.error('✗ dist/sitemap.xml not found');
    process.exit(1);
  }

  const failures =
    report('internal links', brokenLinks) + report('sitemap URLs', brokenSitemap);

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
