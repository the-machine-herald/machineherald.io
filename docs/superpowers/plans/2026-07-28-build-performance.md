# Build Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the site build from 571s to roughly 310s and bring `dist/` from 16,417 files down to about 10,360, well clear of Cloudflare Pages' hard 20,000-file deployment ceiling.

**Architecture:** Three independent changes. A content-addressed on-disk cache makes OG image rendering a one-time cost per article instead of a per-build cost. A minimum-article threshold on tag and source-domain pages removes ~6,000 thin-content routes. Two per-page collection scans that were quadratic in the archive size get precomputed once in `getStaticPaths`. Deployment moves from Cloudflare's Git integration (20-minute timeout, no cross-build cache) to a GitHub Actions job that builds with warm caches and uploads with `wrangler pages deploy`.

**Tech Stack:** Astro 6 (static output), TypeScript (strict), Vitest, satori + `@resvg/resvg-js` for OG images, Pagefind, GitHub Actions, Cloudflare Pages direct upload via `cloudflare/wrangler-action@v3`.

**Design spec:** `docs/superpowers/specs/2026-07-28-build-performance-design.md`

## Global Constraints

- **Never modify files under `src/content/articles/`, `src/content/submissions/`, or `src/content/provenance/`.** They are Ed25519-signed and SHA-256-hashed; any edit, including whitespace, breaks the provenance chain.
- TypeScript is `astro/tsconfigs/strict` with `strictNullChecks: true` and **`noUncheckedIndexedAccess: true`**. Indexed access yields `T | undefined` — every `array[i]` and `map.get(k)` must be narrowed or defaulted. `npm run build` runs `astro check` first, so a type error fails the build.
- Vitest has **no path aliases configured** (`vitest.config.ts` sets only `globals` and `testTimeout`). Test files import source with relative paths (`../src/lib/x`), matching `tests/schemas.test.ts`.
- A module imported by a Vitest test **must not import `astro:content` at runtime**. Type-only imports (`import type { CollectionEntry } from 'astro:content'`) are erased and are fine.
- Thresholds are exactly **5 articles** for both tags and source domains, per the approved design.
- Per `CLAUDE.md`, pipeline changes require a `package.json` version bump **and** a changelog entry in `src/lib/changelog.ts`. The changelog covers only how articles are created, reviewed, signed, and published — site-rendering changes must not appear there.
- A full `npm run build` currently takes about 9.5 minutes. Tasks that require a build say so explicitly; budget for it.

## File Structure

**Create:**
- `src/lib/og/cache.ts` — content-addressed OG PNG cache. No heavy imports at module scope.
- `src/lib/taxonomy.ts` — pure aggregation and thresholds for tags and source domains. No `astro:content` runtime import; unit-testable.
- `src/lib/taxonomy-index.ts` — memoized `astro:content` wrapper over `src/lib/taxonomy.ts`. Consumed by pages and components.
- `scripts/check_dist_links.ts` — post-build verifier: every internal link and sitemap URL resolves to a real file.
- `tests/og_cache.test.ts`, `tests/taxonomy.test.ts` — Vitest coverage for the two pure modules.

**Modify:**
- `src/pages/og/[...slug].png.ts`, `src/pages/og-default.png.ts` — use the cached renderer.
- `src/components/SignalPill.astro` — link only when the tag has a page; fix the slug mismatch.
- `src/styles/global.css:104-111` — move `.signal-pill` hover onto `a.signal-pill`.
- `src/pages/signals/[...path].astro`, `src/pages/signals.astro` — consume the shared index.
- `src/pages/sources/[...path].astro`, `src/pages/article/[...slug].astro:255-260` — same for source domains.
- `src/pages/sitemap.xml.ts` — emit only URLs that exist.
- `src/pages/provenance/[...slug].astro`, `src/pages/article/[...slug].astro:69-72` — precompute collection lookups.
- `.github/workflows/deploy.yml` — build and direct-upload deploy.
- `.gitignore`, `package.json`, `src/lib/changelog.ts`.

**Task order rationale:** Task 1 is fully independent. Task 2 builds the verifier *before* the changes it verifies, so the pre-existing broken links are captured as a baseline. Tasks 3–5 are the taxonomy change (pure core, then signals wiring, then sources wiring). Task 6 is independent. Task 7 depends on nothing in 1–6 but should land after them so the first Actions build is the fast one. Tasks 8–9 close out.

---

### Task 1: Content-addressed OG image cache

**Files:**
- Create: `src/lib/og/cache.ts`
- Create: `tests/og_cache.test.ts`
- Modify: `src/pages/og/[...slug].png.ts`
- Modify: `src/pages/og-default.png.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `renderOgPng(input: OgCardInput): Promise<Uint8Array>` and `OgCardInput` from `src/lib/og/render.ts` (unchanged).
- Produces: `OG_CARD_VERSION: number`, `ogCacheKey(input: OgCardInput): string`, `renderOgPngCached(input: OgCardInput): Promise<Uint8Array>`.

`renderOgPng` is loaded with a **dynamic** `import()` inside `renderOgPngCached` so the module graph of `cache.ts` stays free of satori and the native `@resvg/resvg-js` binding. This keeps the unit test fast and lets it run without touching native code.

- [ ] **Step 1: Write the failing test**

Create `tests/og_cache.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ogCacheKey, OG_CARD_VERSION } from '../src/lib/og/cache';

const base = {
  title: 'Astronomers Capture Clearest-Ever Image of Betelgeuse',
  summary: 'A summary of the article.',
  category: 'News',
  date: new Date('2026-07-28T00:00:00.000Z'),
  model: 'Claude Opus 4.6',
  kind: 'article' as const,
};

describe('ogCacheKey', () => {
  it('is a sha256 hex digest', () => {
    expect(ogCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls for the same input', () => {
    expect(ogCacheKey(base)).toBe(ogCacheKey({ ...base }));
  });

  it('ignores the order properties were assigned in', () => {
    const reordered = {
      kind: 'article' as const,
      model: base.model,
      date: base.date,
      category: base.category,
      summary: base.summary,
      title: base.title,
    };
    expect(ogCacheKey(reordered)).toBe(ogCacheKey(base));
  });

  it('changes when the title changes', () => {
    expect(ogCacheKey({ ...base, title: 'Something else' })).not.toBe(ogCacheKey(base));
  });

  it('changes when only the date changes', () => {
    const other = { ...base, date: new Date('2026-07-29T00:00:00.000Z') };
    expect(ogCacheKey(other)).not.toBe(ogCacheKey(base));
  });

  it('distinguishes an absent optional field from an empty one', () => {
    const { model, ...withoutModel } = base;
    expect(ogCacheKey(withoutModel)).not.toBe(ogCacheKey({ ...base, model: '' }));
  });

  it('exposes a positive integer card version', () => {
    expect(Number.isInteger(OG_CARD_VERSION)).toBe(true);
    expect(OG_CARD_VERSION).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/og_cache.test.ts`
Expected: FAIL — cannot resolve `../src/lib/og/cache`.

- [ ] **Step 3: Write the cache module**

Create `src/lib/og/cache.ts`:

```typescript
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OgCardInput } from './render';

/**
 * Build-time cache for Open Graph cards.
 *
 * A card is a pure function of its inputs, and published articles are immutable
 * by design (they are hash-verified and Ed25519-signed), so a rendered PNG never
 * needs regenerating. Cards are stored under a version-scoped directory: bumping
 * OG_CARD_VERSION orphans the whole previous generation at once, which is why no
 * pruning logic is needed here.
 *
 * Bump OG_CARD_VERSION whenever the card design in ./render.ts changes.
 */
export const OG_CARD_VERSION = 1;

const CACHE_DIR = join(process.cwd(), '.cache', 'og', `v${OG_CARD_VERSION}`);

/**
 * Fields are enumerated explicitly rather than JSON.stringify'ing the input, so
 * the key does not depend on property insertion order at the call site.
 */
export function ogCacheKey(input: OgCardInput): string {
  const canonical = JSON.stringify([
    input.title,
    input.summary,
    input.category ?? null,
    input.date ? input.date.toISOString() : null,
    input.model ?? null,
    input.kind ?? 'article',
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export async function renderOgPngCached(input: OgCardInput): Promise<Uint8Array> {
  const file = join(CACHE_DIR, `${ogCacheKey(input)}.png`);
  if (existsSync(file)) {
    return readFileSync(file);
  }

  // Imported lazily so satori and the native resvg binding stay out of this
  // module's graph — it is imported by unit tests that never render anything.
  const { renderOgPng } = await import('./render');
  const png = await renderOgPng(input);

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, png);
  return png;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/og_cache.test.ts`
Expected: PASS, 7 tests.

Note on the `distinguishes an absent optional field` case: `undefined` becomes `null` in the canonical array while `''` stays `''`, so the two digests differ. If this test fails, the `?? null` fallbacks were dropped.

- [ ] **Step 5: Wire the article OG route to the cache**

In `src/pages/og/[...slug].png.ts`, change the import and the call:

```typescript
import { renderOgPngCached } from '@/lib/og/cache';
```

```typescript
  const png = await renderOgPngCached({
    title,
    summary,
    category,
    date,
    model: contributor_model || inferModel(date),
    kind: 'article',
  });
```

Leave `getStaticPaths`, the `Response` construction, and the headers untouched.

- [ ] **Step 6: Wire the default OG route to the cache**

In `src/pages/og-default.png.ts`, replace `import { renderOgPng } from '@/lib/og/render';` with:

```typescript
import { renderOgPngCached } from '@/lib/og/cache';
```

and change `await renderOgPng({` to `await renderOgPngCached({`. Leave everything else as is.

- [ ] **Step 7: Ignore the cache directory**

In `.gitignore`, under the `# Build output` block that already lists `dist/` and `.astro/`, add:

```
.cache/
```

- [ ] **Step 8: Verify the cache works end to end**

This step runs two full builds (~10 minutes each) and is the only proof the cache is correct.

```bash
rm -rf .cache dist
npm run build 2>&1 | tee /tmp/og-build-1.log
find .cache/og -name '*.png' | wc -l          # expect 1892 (1891 articles + default card)
shasum -a 256 dist/og-default.png             # note this digest

npm run build 2>&1 | tee /tmp/og-build-2.log
shasum -a 256 dist/og-default.png             # must match the digest above
```

Compare the `og` section totals between the two logs:

```bash
for f in /tmp/og-build-1.log /tmp/og-build-2.log; do
  echo -n "$f  og total: "
  grep -oE '├─ /og/.*\(\+[0-9]+ms\)' "$f" \
    | grep -oE '\+[0-9]+ms' | tr -d '+ms' \
    | awk '{s+=$1} END {printf "%.1fs\n", s/1000}'
done
```

Expected: run 1 around 140s, run 2 under 5s, and identical PNG digests.

- [ ] **Step 9: Commit**

```bash
git add src/lib/og/cache.ts tests/og_cache.test.ts \
        src/pages/og/\[...slug\].png.ts src/pages/og-default.png.ts .gitignore
git commit -m "perf: cache OG images on disk, keyed by card content"
```

---

### Task 2: Post-build internal link verifier

**Files:**
- Create: `scripts/check_dist_links.ts`
- Modify: `package.json` (add the `verify:links` script)

**Interfaces:**
- Consumes: nothing from earlier tasks. Reads `dist/` produced by `npm run build`.
- Produces: `npm run verify:links` — exits 0 when every internal link and sitemap URL resolves, exits 1 and prints the offenders otherwise.

This task deliberately comes before the taxonomy changes. Running it against the current `dist/` establishes the baseline: it should report broken `/signals/...` links caused by the existing `SignalPill` slug mismatch, which Task 4 then fixes.

- [ ] **Step 1: Write the verifier**

Create `scripts/check_dist_links.ts`:

```typescript
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
```

- [ ] **Step 2: Register the npm script**

In `package.json`, add to `"scripts"` immediately after `"validate:content"`:

```json
    "verify:links": "tsx scripts/check_dist_links.ts",
```

- [ ] **Step 3: Run it against the existing dist to capture the baseline**

`dist/` from the current codebase must be present. If it is not, run `npm run build` first (~10 min).

Run: `npm run verify:links`

Expected: **FAIL (exit 1)** with unresolved `/signals/...` targets — these are the pre-existing 404s from `SignalPill` building hrefs with `signal.toLowerCase().replace(/\s+/g, '-')` while pages are generated with `slugify()`, which also strips punctuation. Save the output:

```bash
npm run verify:links 2>&1 | tee /tmp/links-baseline.txt || true
```

If it reports **zero** broken links, stop and investigate before continuing — the premise of Task 4's slug fix would be wrong and the plan needs revisiting.

If it reports broken targets **outside** `/signals/` — anything under `/topics/`, `/models/`, `/author/`, or a static page — those are pre-existing bugs this plan did not anticipate. Note them explicitly in the commit message or hand them back before continuing: Task 8 makes `verify:links` a blocking CI step, so every reported target must be resolved or the checker narrowed before deploys can gate on it.

- [ ] **Step 4: Commit**

```bash
git add scripts/check_dist_links.ts package.json
git commit -m "test: add post-build internal link and sitemap verifier"
```

---

### Task 3: Pure taxonomy indexing core

**Files:**
- Create: `src/lib/taxonomy.ts`
- Create: `tests/taxonomy.test.ts`

**Interfaces:**
- Consumes: `slugify(text: string): string` and `extractDomain(url: string): string` from `src/lib/utils.ts`.
- Produces:
  - `MIN_SIGNAL_ARTICLES: number` (= 5), `MIN_SOURCE_ARTICLES: number` (= 5)
  - `interface TaxonomyArticle { id: string; data: { tags: string[]; sources: string[]; draft?: boolean } }`
  - `interface SignalGroup<T> { signal: string; slug: string; articles: T[] }`
  - `interface SourceGroup<T> { domain: string; articles: T[] }`
  - `buildSignalIndex<T extends TaxonomyArticle>(articles: T[], min?: number): Map<string, SignalGroup<T>>` — keyed by slug
  - `buildSourceIndex<T extends TaxonomyArticle>(articles: T[], min?: number): Map<string, SourceGroup<T>>` — keyed by domain

Both functions drop drafts, deduplicate articles within a group, and return only groups meeting the threshold. Keying signals by slug preserves the existing behaviour where two tag spellings that slugify identically share one page.

- [ ] **Step 1: Write the failing test**

Create `tests/taxonomy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  MIN_SIGNAL_ARTICLES,
  MIN_SOURCE_ARTICLES,
  buildSignalIndex,
  buildSourceIndex,
  type TaxonomyArticle,
} from '../src/lib/taxonomy';

function article(
  id: string,
  tags: string[],
  sources: string[] = [],
  draft = false
): TaxonomyArticle {
  return { id, data: { tags, sources, draft } };
}

/** n articles all carrying `tag`, ids prefixed to keep them distinct. */
function withTag(tag: string, n: number, prefix = 't'): TaxonomyArticle[] {
  return Array.from({ length: n }, (_, i) => article(`${prefix}-${i}`, [tag]));
}

describe('thresholds', () => {
  it('are both 5', () => {
    expect(MIN_SIGNAL_ARTICLES).toBe(5);
    expect(MIN_SOURCE_ARTICLES).toBe(5);
  });
});

describe('buildSignalIndex', () => {
  it('includes a tag that meets the threshold exactly', () => {
    const index = buildSignalIndex(withTag('Quantum Computing', 5));
    expect([...index.keys()]).toEqual(['quantum-computing']);
    expect(index.get('quantum-computing')?.articles).toHaveLength(5);
    expect(index.get('quantum-computing')?.signal).toBe('Quantum Computing');
  });

  it('excludes a tag one article below the threshold', () => {
    const index = buildSignalIndex(withTag('Quantum Computing', 4));
    expect(index.size).toBe(0);
  });

  it('does not count draft articles toward the threshold', () => {
    const articles = [
      ...withTag('Robotics', 4),
      article('draft-1', ['Robotics'], [], true),
    ];
    expect(buildSignalIndex(articles).size).toBe(0);
  });

  it('merges tag spellings that share a slug', () => {
    const articles = [
      ...withTag('GPT-5.4', 3, 'a'),
      ...withTag('GPT 54', 2, 'b'),
    ];
    const index = buildSignalIndex(articles);
    expect(index.size).toBe(1);
    expect(index.get('gpt-54')?.articles).toHaveLength(5);
  });

  it('counts an article once even if two of its tags share a slug', () => {
    const articles = [
      { id: 'dup', data: { tags: ['GPT-5.4', 'GPT 54'], sources: [], draft: false } },
      ...withTag('GPT-5.4', 4, 'c'),
    ];
    const index = buildSignalIndex(articles);
    expect(index.get('gpt-54')?.articles).toHaveLength(5);
  });

  it('honours an explicit threshold override', () => {
    const index = buildSignalIndex(withTag('Robotics', 2), 2);
    expect(index.size).toBe(1);
  });

  it('returns an empty index for no articles', () => {
    expect(buildSignalIndex([]).size).toBe(0);
  });
});

describe('buildSourceIndex', () => {
  const src = (n: number, host: string) =>
    Array.from({ length: n }, (_, i) =>
      article(`s-${host}-${i}`, [], [`https://${host}/story-${i}`])
    );

  it('includes a domain that meets the threshold', () => {
    const index = buildSourceIndex(src(5, 'reuters.com'));
    expect([...index.keys()]).toEqual(['reuters.com']);
    expect(index.get('reuters.com')?.articles).toHaveLength(5);
  });

  it('excludes a domain below the threshold', () => {
    expect(buildSourceIndex(src(4, 'reuters.com')).size).toBe(0);
  });

  it('strips the www prefix so both spellings share a group', () => {
    const articles = [
      ...src(3, 'reuters.com'),
      article('w-1', [], ['https://www.reuters.com/a']),
      article('w-2', [], ['https://www.reuters.com/b']),
    ];
    const index = buildSourceIndex(articles);
    expect(index.size).toBe(1);
    expect(index.get('reuters.com')?.articles).toHaveLength(5);
  });

  it('counts an article once when it cites the same domain twice', () => {
    const articles = [
      article('multi', [], ['https://reuters.com/a', 'https://reuters.com/b']),
      ...src(4, 'reuters.com'),
    ];
    expect(buildSourceIndex(articles).get('reuters.com')?.articles).toHaveLength(5);
  });

  it('does not count draft articles toward the threshold', () => {
    const articles = [
      ...src(4, 'reuters.com'),
      article('draft-s', [], ['https://reuters.com/x'], true),
    ];
    expect(buildSourceIndex(articles).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: FAIL — cannot resolve `../src/lib/taxonomy`.

- [ ] **Step 3: Write the taxonomy core**

Create `src/lib/taxonomy.ts`:

```typescript
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
```

Note: deleting from a `Map` while iterating it is well-defined in JavaScript — entries already visited are unaffected and the deleted key is simply skipped. This is why the filter is a second pass rather than a rebuild.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: PASS, 15 tests.

If the run fails on resolving `astro:content`, `src/lib/utils.ts` gained a runtime (non-`type`) import from it — check line 1 is still `import type { CollectionEntry } from 'astro:content';`.

- [ ] **Step 5: Run the whole suite to check nothing regressed**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/taxonomy.ts tests/taxonomy.test.ts
git commit -m "feat: add taxonomy indexing core with article-count thresholds"
```

---

### Task 4: Apply the signal threshold

**Files:**
- Create: `src/lib/taxonomy-index.ts`
- Modify: `src/pages/signals/[...path].astro`
- Modify: `src/components/SignalPill.astro`
- Modify: `src/styles/global.css:104-111`
- Modify: `src/pages/signals.astro`
- Modify: `src/pages/sitemap.xml.ts` (signals section only)

**Interfaces:**
- Consumes: `buildSignalIndex`, `buildSourceIndex`, `SignalGroup`, `SourceGroup` from `src/lib/taxonomy.ts` (Task 3).
- Produces:
  - `getSignalIndex(): Promise<Map<string, SignalGroup<CollectionEntry<'articles'>>>>`
  - `getSourceIndex(): Promise<Map<string, SourceGroup<CollectionEntry<'articles'>>>>`
  - `hasSignalPage(tag: string): Promise<boolean>`
  - `hasSourcePage(url: string): Promise<boolean>` — takes a full source URL, not a bare domain

Both indexes are memoized at module scope, so `getCollection('articles')` and the grouping run once per build no matter how many pages and components ask.

- [ ] **Step 1: Write the memoized index wrapper**

Create `src/lib/taxonomy-index.ts`:

```typescript
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
```

- [ ] **Step 2: Rewrite the signals route to consume the index**

Replace the frontmatter of `src/pages/signals/[...path].astro` (lines 1–73, everything above the closing `---`) with:

```astro
---
import Layout from '@/layouts/Layout.astro';
import ArticleCard from '@/components/ArticleCard.astro';
import Pagination from '@/components/Pagination.astro';
import { getSignalIndex } from '@/lib/taxonomy-index';
import { sortByDate, slugify, ARTICLES_PER_PAGE } from '@/lib/utils';
import type { CollectionEntry } from 'astro:content';

export async function getStaticPaths() {
  const index = await getSignalIndex();

  const paths: Array<{
    params: { path: string };
    props: {
      signal: string;
      articles: CollectionEntry<'articles'>[];
      currentPage: number;
      totalPages: number;
      totalArticles: number;
    };
  }> = [];

  for (const [slug, group] of index) {
    const sorted = sortByDate(group.articles);
    const totalPages = Math.ceil(sorted.length / ARTICLES_PER_PAGE);

    for (let page = 1; page <= totalPages; page++) {
      const start = (page - 1) * ARTICLES_PER_PAGE;
      paths.push({
        // Page 1 lives at /signals/<slug>, later pages at /signals/<slug>/<n>
        params: { path: page === 1 ? slug : `${slug}/${page}` },
        props: {
          signal: group.signal,
          articles: sorted.slice(start, start + ARTICLES_PER_PAGE),
          currentPage: page,
          totalPages,
          totalArticles: sorted.length,
        },
      });
    }
  }

  return paths;
}

interface Props {
  signal: string;
  articles: CollectionEntry<'articles'>[];
  currentPage: number;
  totalPages: number;
  totalArticles: number;
}

const { signal, articles, currentPage, totalPages, totalArticles } = Astro.props;
const basePath = `/signals/${slugify(signal)}`;
---
```

Leave the template below the `---` unchanged — it already reads `signal`, `articles`, `currentPage`, `totalPages`, `totalArticles`, and `basePath`.

- [ ] **Step 3: Make SignalPill link only when a page exists**

Replace the entire contents of `src/components/SignalPill.astro` with:

```astro
---
import { hasSignalPage } from '@/lib/taxonomy-index';
import { slugify } from '@/lib/utils';

interface Props {
  signal: string;
  count?: number;
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}

const { signal, count, href, size = 'sm' } = Astro.props;

// Tags below the article threshold have no page. They stay visible — the tag is
// editorial information — but render as plain text instead of a dead link.
const linked = href !== undefined || (await hasSignalPage(signal));
// slugify() must match how /signals/[...path] generates its params: it strips
// punctuation, which a bare toLowerCase().replace(/\s+/g,'-') does not.
const signalUrl = href ?? `/signals/${slugify(signal)}`;
const Tag = linked ? 'a' : 'span';
---

<Tag
  href={linked ? signalUrl : undefined}
  class:list={[
    'signal-pill',
    size === 'md' && 'px-3 py-1 text-sm',
    size === 'lg' && 'px-4 py-2 text-base',
  ]}
>
  <span>{signal}</span>
  {count !== undefined && (
    <span class="ml-1 opacity-60">({count})</span>
  )}
</Tag>
```

- [ ] **Step 4: Scope the pill hover style to links only**

In `src/styles/global.css`, replace the `.signal-pill` block at lines 104–111 with:

```css
  .signal-pill {
    @apply inline-flex items-center rounded-full px-2.5 py-0.5;
    @apply text-xs font-medium;
    @apply bg-zinc-100 text-zinc-700;
    @apply dark:bg-zinc-800 dark:text-zinc-300;
    @apply transition-colors duration-150;
  }

  /* Hover affordance belongs only to pills that actually navigate. */
  a.signal-pill {
    @apply hover:bg-zinc-200 dark:hover:bg-zinc-700;
  }
```

- [ ] **Step 5: List only linkable signals on the signals index**

In `src/pages/signals.astro`, replace the frontmatter (lines 1–9) with:

```astro
---
import Layout from '@/layouts/Layout.astro';
import SignalPill from '@/components/SignalPill.astro';
import { getSignalIndex } from '@/lib/taxonomy-index';

const index = await getSignalIndex();
const allSignals = [...index.values()]
  .map((group) => ({ signal: group.signal, count: group.articles.length }))
  .sort((a, b) => b.count - a.count);
---
```

Then update the loop in the template (currently line 29–31) to match the new shape:

```astro
        {allSignals.map(({ signal, count }) => (
          <SignalPill signal={signal} count={count} size="md" />
        ))}
```

`getAllSignals` is no longer used here; leave the helper in `src/lib/utils.ts` (`src/pages/index.astro` still uses it).

- [ ] **Step 6: Emit only existing signal URLs in the sitemap**

In `src/pages/sitemap.xml.ts`:

Add to the imports:

```typescript
import { getSignalIndex } from '@/lib/taxonomy-index';
```

Replace `const signals = getAllSignals(publishedArticles);` with:

```typescript
  const signalIndex = await getSignalIndex();
```

and replace the signals block (the `${[...signals.keys()].map(...)}` template section) with:

```typescript
  ${[...signalIndex.keys()]
    .map(
      (slug) => `
  <url>
    <loc>${SITE.url}/signals/${slug}</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`
    )
    .join('')}
```

Remove `getAllSignals` and `slugify` from the `@/lib/utils` import if nothing else in the file uses them — `astro check` will flag them as unused otherwise.

- [ ] **Step 7: Type-check**

Run: `npx astro check`
Expected: 0 errors. Hints and warnings are acceptable; the pre-existing baseline is 0 errors / 0 warnings / 7 hints.

- [ ] **Step 8: Commit**

```bash
git add src/lib/taxonomy-index.ts src/pages/signals/\[...path\].astro \
        src/components/SignalPill.astro src/styles/global.css \
        src/pages/signals.astro src/pages/sitemap.xml.ts
git commit -m "perf: generate signal pages only for tags with 5+ articles"
```

---

### Task 5: Apply the source-domain threshold

**Files:**
- Modify: `src/pages/sources/[...path].astro`
- Modify: `src/pages/article/[...slug].astro:255-260`
- Modify: `src/pages/sitemap.xml.ts` (sources section only)

**Interfaces:**
- Consumes: `getSourceIndex()` and `hasSourcePage(url)` from `src/lib/taxonomy-index.ts` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Rewrite the sources route to consume the index**

Replace the frontmatter of `src/pages/sources/[...path].astro` (lines 1–76, everything above the closing `---`) with:

```astro
---
import Layout from '@/layouts/Layout.astro';
import ArticleCard from '@/components/ArticleCard.astro';
import Pagination from '@/components/Pagination.astro';
import { getSourceIndex } from '@/lib/taxonomy-index';
import { sortByDate, ARTICLES_PER_PAGE } from '@/lib/utils';
import type { CollectionEntry } from 'astro:content';

export async function getStaticPaths() {
  const index = await getSourceIndex();

  const paths: Array<{
    params: { path: string };
    props: {
      domain: string;
      articles: CollectionEntry<'articles'>[];
      currentPage: number;
      totalPages: number;
      totalArticles: number;
    };
  }> = [];

  for (const [domain, group] of index) {
    const sorted = sortByDate(group.articles);
    const totalPages = Math.ceil(sorted.length / ARTICLES_PER_PAGE);

    for (let page = 1; page <= totalPages; page++) {
      const start = (page - 1) * ARTICLES_PER_PAGE;
      paths.push({
        params: { path: page === 1 ? domain : `${domain}/${page}` },
        props: {
          domain,
          articles: sorted.slice(start, start + ARTICLES_PER_PAGE),
          currentPage: page,
          totalPages,
          totalArticles: sorted.length,
        },
      });
    }
  }

  return paths;
}

interface Props {
  domain: string;
  articles: CollectionEntry<'articles'>[];
  currentPage: number;
  totalPages: number;
  totalArticles: number;
}

const { domain, articles, currentPage, totalPages, totalArticles } = Astro.props;
const basePath = `/sources/${domain}`;
---
```

Leave the template below the `---` unchanged.

- [ ] **Step 2: Precompute which sources are linkable on the article page**

In `src/pages/article/[...slug].astro`, add to the imports:

```typescript
import { hasSourcePage } from '@/lib/taxonomy-index';
```

Then in the component frontmatter, near the other derived values (after the `provenance` line around line 67), add:

```typescript
// Domains below the article threshold have no /sources page; their label stays
// as plain text. Resolved up front because the template cannot await per item.
const sourceLinks = await Promise.all(
  sources.map(async (source) => ({
    url: source,
    domain: extractDomain(source),
    linked: await hasSourcePage(source),
  }))
);
```

- [ ] **Step 3: Render unlinked domains as plain text**

In the same file, replace the whole map block inside the Sources section (lines 239–263, from `{` before `sources.map` through the closing `}`) with:

```astro
          {
            sourceLinks.map((link, index) => (
              <li class="flex items-start gap-3 text-sm">
                <span class="font-mono text-text-muted-light dark:text-text-muted-dark shrink-0">
                  [{index + 1}]
                </span>
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-accent hover:underline break-all"
                  >
                    {link.url}
                  </a>
                  {link.linked ? (
                    <a
                      href={`/sources/${link.domain}`}
                      class="font-mono text-xs text-text-muted-light dark:text-text-muted-dark hover:text-accent transition-colors shrink-0"
                    >
                      ({link.domain})
                    </a>
                  ) : (
                    <span class="font-mono text-xs text-text-muted-light dark:text-text-muted-dark shrink-0">
                      ({link.domain})
                    </span>
                  )}
                </div>
              </li>
            ))
          }
```

The `<h2>` above it still reads `Sources ({sources.length})` and needs no change — `sources` stays in scope. Only the external link and the `(domain.com)` label are affected; the external link is unchanged.

- [ ] **Step 4: Emit only existing source URLs in the sitemap**

In `src/pages/sitemap.xml.ts`, add `getSourceIndex` to the existing `@/lib/taxonomy-index` import:

```typescript
import { getSignalIndex, getSourceIndex } from '@/lib/taxonomy-index';
```

Replace the block that builds `const sources = new Set<string>(); publishedArticles.forEach(...)` with:

```typescript
  const sourceIndex = await getSourceIndex();
```

and replace the `${[...sources].map(...)}` template section with:

```typescript
  ${[...sourceIndex.keys()]
    .map(
      (domain) => `
  <url>
    <loc>${SITE.url}/sources/${domain}</loc>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
  </url>`
    )
    .join('')}
```

Remove `extractDomain` from the `@/lib/utils` import if nothing else in the file uses it.

- [ ] **Step 5: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/sources/\[...path\].astro src/pages/article/\[...slug\].astro \
        src/pages/sitemap.xml.ts
git commit -m "perf: generate source pages only for domains with 5+ articles"
```

---

### Task 6: Remove per-page collection scans

**Files:**
- Modify: `src/pages/provenance/[...slug].astro:1-24`
- Modify: `src/pages/article/[...slug].astro:21-72`

**Interfaces:**
- Consumes: `ReviewData` type from `src/lib/provenance.ts` (already exported).
- Produces: no new exports. `loadReviewsByTitle` stays exported for other callers but leaves the hot path.

`loadReviewsByTitle` calls `getCollection('reviews')` (2,150 entries) and filters plus sorts it once per provenance page across 1,891 pages. The article page does the same with `getCollection('corrections')` (382 entries). Both become a single pass in `getStaticPaths`.

- [ ] **Step 1: Precompute the review lookup in the provenance route**

In `src/pages/provenance/[...slug].astro`, replace lines 1–24 (imports through the `hasMultipleReviews` line) with:

```astro
---
import { getCollection, type CollectionEntry } from 'astro:content';
import Layout from '@/layouts/Layout.astro';
import AuditCard from '@/components/AuditCard.astro';
import ReviewCard from '@/components/ReviewCard.astro';
import { loadProvenance, type ReviewData } from '@/lib/provenance';

export async function getStaticPaths() {
  const articles = await getCollection('articles');
  const allReviews = await getCollection('reviews');

  // Grouped once here instead of re-scanning all reviews on each of the ~1,900
  // generated pages, which was quadratic in the size of the archive.
  const byTitle = new Map<string, ReviewData[]>();
  for (const review of allReviews) {
    const existing = byTitle.get(review.data.article_title);
    if (existing) existing.push(review.data);
    else byTitle.set(review.data.article_title, [review.data]);
  }
  for (const list of byTitle.values()) {
    list.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  return articles.map((article) => ({
    params: { slug: article.id },
    props: {
      article,
      reviews: byTitle.get(article.data.title) ?? [],
    },
  }));
}

interface Props {
  article: CollectionEntry<'articles'>;
  reviews: ReviewData[];
}

const { article, reviews } = Astro.props;
const provenance = await loadProvenance(article.id);
const latestReview = reviews[0] ?? null;
const hasMultipleReviews = reviews.length > 1;
---
```

The template below is unchanged: it already reads `reviews`, `latestReview`, and `hasMultipleReviews`.

- [ ] **Step 2: Precompute the corrections lookup in the article route**

In `src/pages/article/[...slug].astro`, inside `getStaticPaths` (starting line 21), add the corrections collection and a lookup map, and pass the match through props:

```typescript
export async function getStaticPaths() {
  const articles = await getCollection('articles');
  const metas = await getCollection('article-meta');
  const corrections = await getCollection('corrections');
  const metaMap = new Map(metas.map((m) => [m.id, m]));
  // Built once rather than re-scanned on each of the ~1,900 article pages.
  const correctionMap = new Map(
    corrections.map((c) => [c.data.article_slug, c])
  );

  const allWithMeta: ArticleWithMeta[] = articles.map((article) => ({
    article,
    meta: metaMap.get(article.id) ?? null,
  }));

  return articles.map((article) => {
    const meta = metaMap.get(article.id) ?? null;
    const current: ArticleWithMeta = { article, meta };
    const related = getRelatedArticles(current, allWithMeta);
    return {
      params: { slug: article.id },
      props: {
        article,
        meta,
        related,
        articleCorrections: correctionMap.get(article.id) ?? null,
      },
    };
  });
}
```

Extend the `Props` interface (currently lines 42–46):

```typescript
interface Props {
  article: CollectionEntry<'articles'>;
  meta: CollectionEntry<'article-meta'> | null;
  related: import('@/lib/article-meta').RelatedArticle[];
  articleCorrections: CollectionEntry<'corrections'> | null;
}
```

Change the destructure on line 48 to:

```typescript
const { article, meta, related, articleCorrections } = Astro.props;
```

And delete the now-dead lookup at lines 69–72:

```typescript
const allCorrections = await getCollection('corrections');
const articleCorrections = allCorrections.find(
  (c) => c.data.article_slug === article.id
);
```

The template's two uses at lines 214–217 (`articleCorrections.data.corrections` and `articleCorrections.data.date`) keep working unchanged.

- [ ] **Step 3: Type-check**

Run: `npx astro check`
Expected: 0 errors. If it reports `getCollection` as unused in the article page, keep it — `getStaticPaths` still calls it.

- [ ] **Step 4: Commit**

```bash
git add src/pages/provenance/\[...slug\].astro src/pages/article/\[...slug\].astro
git commit -m "perf: precompute review and correction lookups in getStaticPaths"
```

---

### Task 7: Full verification build

**Files:** none modified. This task proves Tasks 1–6 landed correctly before the deploy pipeline changes.

**Interfaces:**
- Consumes: `npm run verify:links` from Task 2.
- Produces: measured before/after numbers to check against the design spec.

- [ ] **Step 1: Run a clean, instrumented build**

The OG cache is intentionally kept warm here — this measures the steady state a CI run will see.

```bash
rm -rf dist
{ echo "START $(date +%s)"; \
  npx astro check > /tmp/mh-check.log 2>&1; echo "CHECK_DONE $(date +%s)"; \
  npx astro build > /tmp/mh-build.log 2>&1; echo "BUILD_DONE $(date +%s)"; \
  npx pagefind --site dist > /tmp/mh-pagefind.log 2>&1; echo "PAGEFIND_DONE $(date +%s)"; \
} | tee /tmp/mh-timings.txt
```

- [ ] **Step 2: Aggregate the per-section timings**

```bash
grep -oE '├─ /[a-z0-9-]+[/.].*\(\+[0-9]+ms\)' /tmp/mh-build.log \
  | sed -E 's#├─ /([a-z0-9-]+)[/.].*\(\+([0-9]+)ms\)#\1 \2#' \
  | awk '{s[$1]+=$2; c[$1]++} END {for (k in s) printf "%9.1fs  n=%-6d avg=%5.0fms  %s\n", s[k]/1000, c[k], s[k]/c[k], k}' \
  | sort -rn
```

Expected, against the 2026-07-28 baseline:

| Section | Before | Expected after |
|---|---|---|
| og | 140.6s / 1,891 | under 5s (cache hits) |
| provenance | 77.8s / 2,081 | ~40s |
| signals | 76.7s / 4,977 | ~9s / ~575 routes |
| sources | 33.4s / 2,152 | ~8s / ~495 routes |
| article | 37.0s / 1,891 | ~37s / 1,891 |

Total wall clock should land near 310s, down from 571s. Treat a section landing within roughly 30% of its expected value as a pass; a section that did not move at all means its task did not take effect.

- [ ] **Step 3: Verify the file count dropped**

```bash
find dist -type f | wc -l
```

Expected: roughly 10,360, down from 16,417. Anything above 12,000 means one of the thresholds is not being applied — check that `MIN_SIGNAL_ARTICLES` and `MIN_SOURCE_ARTICLES` are both 5 and that the routes consume the index rather than their old inline aggregation.

- [ ] **Step 4: Verify no broken internal links remain**

Run: `npm run verify:links`
Expected: **PASS (exit 0)** — "all targets resolve" for both internal links and sitemap URLs.

This is the load-bearing check of the whole taxonomy change. Compare against `/tmp/links-baseline.txt` from Task 2: the pre-existing `/signals/...` 404s must be gone, and no new `/sources/...` breakage introduced. If it fails, the offending URLs are printed with the pages that link to them.

**This step must reach exit 0 before Task 8**, which makes `verify:links` a required step in the deploy workflow. If the only remaining failures are pre-existing breakage outside this plan's scope (flagged in Task 2 Step 3), that is a decision point: either fix them here, or stop and raise it — do not wire a known-failing check into the deploy gate.

- [ ] **Step 5: Spot-check the rendered output by eye**

```bash
npm run preview
```

Open an article page and confirm: tags below the threshold render as pills with no link and no hover highlight, tags above it still navigate, the `(domain.com)` label next to each source behaves the same way, and `/signals` lists only the recurring tags. Then stop the preview server.

- [ ] **Step 6: Commit any fixes**

No commit if nothing needed fixing. If the checks surfaced problems, fix them and commit before continuing:

```bash
git commit -am "fix: <what the verification build surfaced>"
```

---

### Task 8: Build and deploy from GitHub Actions

**Files:**
- Modify: `.github/workflows/deploy.yml` (full rewrite)

**Interfaces:**
- Consumes: repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and repository variable `CLOUDFLARE_PAGES_PROJECT` (= `machineherald-io`). All three are already set as of 2026-07-28.
- Produces: a `Build and Deploy` workflow, dispatchable manually and triggered by a successful `Publish from Submission` run.

The current file only POSTs to `CLOUDFLARE_DEPLOY_HOOK`, which makes Cloudflare clone the repo and build it under a 20-minute cap with no cross-build cache. That secret stays in place as a fallback until the cutover is confirmed.

**Prerequisite:** Task 7 Step 4 must have exited 0. This workflow runs `verify:links` as a blocking step before deploying, so a checker that still reports failures would block every deploy.

- [ ] **Step 1: Replace the workflow**

Overwrite `.github/workflows/deploy.yml` with:

```yaml
name: Build and Deploy

on:
  workflow_dispatch:
  workflow_run:
    workflows: ["Publish from Submission"]
    types:
      - completed

# One deploy at a time; a newer publish supersedes an in-flight build.
concurrency:
  group: deploy
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  deploy:
    name: Build and Deploy to Cloudflare Pages
    runs-on: ubuntu-latest
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          # Always build the current tip of main. A workflow_run event carries
          # the triggering commit, but the publish job pushes to main after it,
          # so the triggering sha can already be stale.
          ref: main
          fetch-depth: 1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Restore build caches
        uses: actions/cache/restore@v4
        with:
          # .cache/og holds rendered OG cards (content-addressed, immutable).
          # .astro holds the content-layer store, which lets Astro skip
          # re-processing markdown that has not changed.
          path: |
            .cache/og
            .astro
          key: build-${{ github.sha }}-${{ github.run_id }}
          restore-keys: |
            build-

      - name: Build
        run: npm run build

      - name: Save build caches
        uses: actions/cache/save@v4
        with:
          path: |
            .cache/og
            .astro
          key: build-${{ github.sha }}-${{ github.run_id }}

      - name: Check deployment file count
        run: |
          COUNT=$(find dist -type f | wc -l)
          echo "dist contains $COUNT files (Cloudflare Pages limit: 20000)"
          echo "### Deployment size" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "\`dist/\`: **$COUNT** files / 20000 limit" >> $GITHUB_STEP_SUMMARY
          if [ "$COUNT" -gt 19000 ]; then
            echo "::error::dist has $COUNT files, at the 20,000 Cloudflare Pages ceiling. Raise the taxonomy thresholds in src/lib/taxonomy.ts."
            exit 1
          fi
          if [ "$COUNT" -gt 16000 ]; then
            echo "::warning::dist has $COUNT files, approaching the 20,000 Cloudflare Pages ceiling."
          fi

      - name: Verify internal links
        run: npm run verify:links

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=${{ vars.CLOUDFLARE_PAGES_PROJECT }} --branch=main

      - name: Summary
        run: |
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "Deployed commit \`${{ github.sha }}\` to [machineherald.io](https://machineherald.io)" >> $GITHUB_STEP_SUMMARY
          echo "Triggered by: ${{ github.event_name }}" >> $GITHUB_STEP_SUMMARY
```

Notes on choices here. The cache save step has no `if: always()` — a failed build must not persist a half-written `.astro` store. The cache key carries `run_id` because `actions/cache/save` errors when a key already exists, which would otherwise break any re-run on the same commit; `restore-keys: build-` still restores the most recent entry. `verify:links` runs before deploy so a broken link surface never reaches production.

- [ ] **Step 2: Validate the workflow syntax**

Run: `gh workflow view "Build and Deploy" 2>/dev/null || echo "not yet registered — expected before the first push"`

The workflow only registers with GitHub once pushed. Locally, confirm it parses:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: build and deploy from Actions with wrangler direct upload"
git push origin main
```

- [ ] **Step 4: Trigger a manual run and watch it**

```bash
gh workflow run "Build and Deploy"
sleep 10
gh run watch "$(gh run list --workflow='Build and Deploy' --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: all steps green. The first run has a cold OG cache, so budget 12–18 minutes; subsequent runs should be markedly faster.

**Do not proceed if this fails.** The likely failure is the `Deploy to Cloudflare Pages` step reporting that the project is connected to a Git repository and does not accept direct uploads — that is the manual step in the design spec (A3, step 1) which has deliberately not been done yet. If that is the error, stop and hand back to the repository owner: they need to disconnect the Git integration on the `machineherald-io` Pages project (Settings → Builds & deployments), which preserves the project and its custom domain, then re-run this step.

- [ ] **Step 5: Confirm the deployment is live**

```bash
gh run view "$(gh run list --workflow='Build and Deploy' --limit 1 --json databaseId --jq '.[0].databaseId')" --log | grep -i "deployment complete\|pages.dev"
curl -sI https://machineherald.io | head -1
```

Expected: a `*.pages.dev` deployment URL in the log and `HTTP/2 200` from the live site.

- [ ] **Step 6: Verify a second run hits the caches**

```bash
gh workflow run "Build and Deploy"
```

Expected: the `Restore build caches` step reports a cache hit, and total run time drops well below the first run.

---

### Task 9: Version bump and changelog

**Files:**
- Modify: `package.json` (version)
- Modify: `src/lib/changelog.ts` (new entry at the head of the array)

**Interfaces:**
- Consumes: nothing.
- Produces: version `3.16.0`.

Per `CLAUDE.md` the changelog carries only pipeline changes — how articles are created, reviewed, signed, and published. The deploy-path change qualifies. The taxonomy thresholds and the `SignalPill` fix are site rendering and must **not** appear in this entry.

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "3.15.0"` to `"version": "3.16.0"`.

- [ ] **Step 2: Add the changelog entry**

In `src/lib/changelog.ts`, insert as the first element of the `changelog` array, immediately after `export const changelog: ChangelogEntry[] = [`:

```typescript
  {
    version: '3.16.0',
    date: '2026-07-28',
    items: [
      '<strong>Publishing now builds and deploys from GitHub Actions.</strong> A merged submission previously triggered a Cloudflare Pages Git build, which cloned the full repository and rebuilt the archive from scratch under a 20-minute cap with no cache between runs — at 1,891 articles a measured build took 571s locally and was approaching that ceiling on Cloudflare\'s slower runners. <code>.github/workflows/deploy.yml</code> now builds on an Actions runner with warm caches and uploads the result with <code>wrangler pages deploy</code> (direct upload), removing the timeout as a failure mode for the publish path',
      '<strong>Open Graph cards are cached across builds.</strong> A card is a pure function of an article\'s title, summary, category, date, and contributor model, and published articles are immutable, so a rendered PNG never needs regenerating. <code>src/lib/og/cache.ts</code> stores each card under a content-addressed, version-scoped path (<code>.cache/og/v&lt;OG_CARD_VERSION&gt;/&lt;sha256&gt;.png</code>) and the build reuses it; bumping <code>OG_CARD_VERSION</code> invalidates every card at once when the design changes. This takes OG rendering from 140.6s per build to the cost of the newly published articles only',
      '<strong>Deployment size guard.</strong> Cloudflare Pages rejects a deployment above 20,000 files, and the site was at 16,417 and growing by roughly 7 files per published article. The deploy workflow now counts <code>dist/</code> before uploading, warns above 16,000, and fails above 19,000 rather than letting a publish break on the platform limit. A companion check (<code>npm run verify:links</code>, <code>scripts/check_dist_links.ts</code>) asserts every internal link and sitemap URL resolves to a generated file before the deploy step runs',
    ],
  },
```

- [ ] **Step 3: Verify the changelog renders**

Run: `npx astro check`
Expected: 0 errors — catches an unescaped apostrophe or a malformed entry.

- [ ] **Step 4: Commit and push**

```bash
git add package.json src/lib/changelog.ts
git commit -m "v3.16.0: Build and deploy from GitHub Actions with cached OG cards"
git push origin main
```

- [ ] **Step 5: Confirm the changelog page is live after the deploy**

The push triggers nothing on its own — `workflow_run` fires on `Publish from Submission`, not on plain pushes. Dispatch a deploy:

```bash
gh workflow run "Build and Deploy"
```

Then, once it completes, check `https://machineherald.io/pipeline` shows 3.16.0 at the top.

---

## Post-implementation handoff

Two items remain with the repository owner and are deliberately not automated:

1. **Disconnect the Git integration** on the `machineherald-io` Cloudflare Pages project if Task 8 Step 4 surfaced the direct-upload error. Until then the old Git-triggered build may still fire on push, producing duplicate deploys.
2. **Retire `CLOUDFLARE_DEPLOY_HOOK`** once several publishes have gone out cleanly through Actions. It is kept as the fallback deploy path during cutover; deleting it earlier removes the only escape hatch.

The `deploy.yml` `workflow_run` trigger is enabled from the start of Task 8, restoring the automatic post-publish deploy that is currently commented out in the repository.
