# Build performance: OG cache, GitHub Actions deploy, taxonomy thresholds

**Date:** 2026-07-28
**Status:** Approved design, pending implementation plan

## Problem

The full site build takes 571s (9m31s) on a local Apple Silicon Mac. On a
Cloudflare Pages runner — slower, shared, plus a git clone of a 578 MB pack and
a cold `npm install` — this lands at or beyond the 20-minute Pages build
timeout. The cost grows with every published article.

A second, harder constraint surfaced during measurement: `dist/` currently holds
**16,417 files** against Cloudflare Pages' hard ceiling of **20,000 files per
deployment**. Each published article adds roughly 7 files (article page, OG
image, provenance page, Pagefind fragment, taxonomy pages). At the current
publishing rate the project hits that ceiling in about six months, at which
point deploys fail outright. This is not a performance problem and no amount of
build-time tuning fixes it.

### Measured breakdown

Local build, `npm run build` (astro check && astro build && pagefind):

| Phase | Time |
|---|---|
| `astro check` | 8s |
| Vite bundle (compiles 1,891 markdown entries) | 138s |
| Rendering 14,370 routes | 403s |
| `pagefind` | 17s |
| **Total** | **571s** |

Within the 403s of route rendering:

| Section | Time | Routes | Avg |
|---|---|---|---|
| `og` (satori + resvg PNG) | 140.6s | 1,891 | 74ms |
| `provenance` | 77.8s | 2,081 | 37ms |
| `signals` | 76.7s | 4,977 | 15ms |
| `article` | 37.0s | 1,891 | 20ms |
| `sources` | 33.4s | 2,152 | 16ms |
| topics / models / author / articles / analysis | ~38s | 1,378 | — |

### Contributing findings

- **Tag sprawl.** 1,891 articles carry 5,551 unique tags. 3,971 of those appear
  on exactly one article. The `/signals` index page renders every tag as a pill
  and weighs 800 KB.
- **Source sprawl.** 1,880 unique source domains, 1,186 of which appear on a
  single article.
- **Quadratic scan in provenance.** `loadReviewsByTitle` in `src/lib/provenance.ts`
  calls `getCollection('reviews')` (2,150 entries) and filters + sorts it once
  per page, across 1,891 provenance pages. `src/pages/article/[...slug].astro`
  does the same with `getCollection('corrections')`.
- **Broken tag links.** `src/components/SignalPill.astro:10` builds its href with
  `signal.toLowerCase().replace(/\s+/g, '-')`, while `src/pages/signals/[...path].astro`
  generates paths with `slugify()`, which additionally strips `[^\w\s-]`. Any tag
  containing punctuation currently links to a 404. Pre-existing bug, in scope
  because this component is being changed anyway.

## Goals

1. Remove the deployment file-count ceiling with durable headroom.
2. Remove the 20-minute build timeout as a failure mode.
3. Cut build wall-clock roughly in half, and make the OG-image cost constant
   per build rather than linear in the archive size.

## Non-goals

- Incremental static rendering of article pages. Astro 6 has no native support
  and a custom implementation is not justified at this scale.
- Reducing the 138s Vite bundle phase beyond whatever the cached `.astro`
  content-layer store gives for free.
- Changing article, submission, or provenance content. Those files are
  cryptographically signed and must not be touched.

## Design

### Part A — Build on GitHub Actions, deploy via wrangler direct upload

The repository is public, so Actions minutes are free and unmetered, and the job
ceiling is 6 hours instead of Pages' 20 minutes. More importantly, running the
build ourselves is what makes cross-build caching possible.

#### A1. Persistent OG image cache

OG cards are deterministic functions of `{title, summary, category, date, model,
kind}`, and articles are immutable by design, so a rendered card never needs
regenerating.

`src/lib/og/render.ts` gains `renderOgPngCached(input)`:

- Compute `key = sha256(JSON.stringify(input))` over the card inputs.
- Look for `.cache/og/v<OG_CARD_VERSION>/<key>.png`. On hit, return its bytes.
- On miss, render via the existing `renderOgPng`, write the file, return bytes.

`OG_CARD_VERSION` is a module constant bumped by hand whenever the card design
changes. Because the version is part of the directory path, a bump orphans the
entire previous generation at once and no pruning logic is needed — the CI cache
key carries the same version, so stale entries are evicted by GitHub rather than
managed by us. Within a version, entries only go stale if an article is deleted,
which the provenance model forbids.

`src/pages/og/[...slug].png.ts` and `src/pages/og-default.png.ts` call the cached
variant. `.cache/` is added to `.gitignore`. The cache benefits local builds and
`astro dev` identically to CI.

#### A2. Rewritten deploy workflow

`.github/workflows/deploy.yml` becomes a build-and-deploy job:

- `actions/checkout` with `fetch-depth: 1` and `ref: main` (a `workflow_run`
  event carries the triggering commit, but we always want the current tip).
- `actions/setup-node` at Node 20 with `cache: npm`, then `npm ci`.
- `actions/cache/restore` for `.cache/og` and `.astro`, keyed on
  `${{ github.sha }}` with a rolling `restore-keys` prefix so every run inherits
  the most recent cache.
- `npm run build`.
- `actions/cache/save` under the run-specific key.
- `wrangler pages deploy dist --project-name=$PAGES_PROJECT --branch=main`, where
  the project name is read from a repository variable. The exact name is not
  recorded anywhere in this repository and must be supplied by the owner from the
  Cloudflare dashboard.

Triggers: `workflow_run` on the "Publish from Submission" workflow — restoring
the behaviour currently commented out in `deploy.yml` — plus `workflow_dispatch`.
A `concurrency: { group: deploy, cancel-in-progress: true }` block prevents
overlapping deploys when articles publish in quick succession.

Caching `.astro` is speculative: the content-layer store may let Astro skip
re-processing unchanged markdown and erode part of the 138s bundle phase. It
costs nothing to include and the plan should measure whether it helps rather
than assume it.

#### A3. Manual Cloudflare steps (owner action, not automated)

A Pages project connected to a Git repository does not accept direct uploads.
Before the workflow can succeed, the project owner must:

1. Disconnect the Git integration on the existing Pages project
   (Settings → Builds & deployments). Project name and custom domain are
   preserved; only the build trigger goes away.
2. Create an API token with the *Cloudflare Pages: Edit* permission.
3. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the repository
   secrets.

These are account-level actions performed by the owner. The implementation
should land the workflow in a state that is inert until the secrets exist, and
the cutover verified with a `workflow_dispatch` run before the automatic trigger
is relied upon.

### Part B — Taxonomy thresholds and rendering fixes

#### B1. Signal threshold

A tag gets its own page only when it appears on **5 or more** published
articles. At the current archive that qualifies 439 tags out of 5,551.

New module `src/lib/signals.ts` exposes a memoized index built once per build:
tag → article count, plus the set of slugs that qualify for a page. It is the
single source of truth for "does this tag have a page", consumed by:

- `src/pages/signals/[...path].astro` — generates paths for qualifying tags only.
- `src/components/SignalPill.astro` — renders an `<a>` when the tag qualifies and
  a visually identical `<span>` when it does not. The pill keeps its styling in
  both cases; only the link disappears. Roughly 92% of pills on article pages
  will be unlinked, which is the accepted consequence of the chosen threshold:
  tag navigation becomes a feature of recurring themes, and the tag stays visible
  as editorial information either way.
- `src/pages/signals.astro` — lists qualifying tags only, taking the index page
  from 800 KB to roughly 70 KB.
- `src/pages/sitemap.xml.ts` — emits only URLs that exist.

The same change fixes the slug mismatch: `SignalPill` must derive its href with
`slugify()` from `src/lib/utils.ts`, matching path generation.

#### B2. Source domain threshold

Same threshold (5 or more articles) applied to source domains, qualifying 223 of
1,880. Affects `src/pages/sources/[...path].astro` and `src/pages/sitemap.xml.ts`.
In the article page's source list (`src/pages/article/[...slug].astro:256`), the
`(domain.com)` link next to each external source becomes plain text when the
domain has no page. The external link to the source itself is unchanged.

#### B3. Remove per-page collection scans

- `src/pages/provenance/[...slug].astro`: build a `Map<article_title, ReviewData[]>`
  once inside `getStaticPaths` and pass the matching entry through props, instead
  of calling `loadReviewsByTitle` per page. `loadReviewsByTitle` stays for any
  other caller but is no longer on the hot path.
- `src/pages/article/[...slug].astro`: same treatment for the
  `getCollection('corrections')` lookup at line 69.

## Expected outcome

| | Before | After |
|---|---|---|
| Vite bundle | 138s | 138s (possibly less with cached `.astro`) |
| OG rendering | 141s | ~2s |
| provenance | 78s | ~40s |
| signals | 77s | ~9s |
| sources | 33s | ~8s |
| article + remaining sections | 91s | 91s |
| check + pagefind | 25s | ~20s |
| **Total** | **571s** | **~310s** |
| **Files in `dist`** | **16,417** | **~10,360** |
| signals pages | 4,977 | ~575 |
| sources pages | 2,152 | ~495 |

File-count headroom goes from 82% of the Pages ceiling to about 52%, restoring
several years of runway at the current publishing rate.

## Verification

- Re-run the instrumented build and compare the per-section totals against the
  table above. The measurement harness used to produce the "before" numbers
  parses `(+NNNms)` markers out of the `astro build` log and aggregates by first
  path segment.
- Confirm `find dist -type f | wc -l` lands near 10,360.
- Confirm no internal link points at a non-generated taxonomy page: crawl
  `dist/` for `href="/signals/…"` and `href="/sources/…"` and assert every target
  exists on disk. This also regression-tests the `SignalPill` slug fix, which
  should turn up existing 404 targets before the change and none after.
- Confirm `dist/sitemap.xml` contains no URL absent from `dist/`.
- Verify the OG cache: two consecutive builds, the second showing the `og`
  section at near-zero, and byte-identical PNGs across both runs.
- Deploy cutover verified by a manual `workflow_dispatch` run before enabling the
  automatic `workflow_run` trigger.

## Versioning

Per `CLAUDE.md`, changes to publishing pipeline logic require a `package.json`
version bump and a changelog entry in `src/lib/changelog.ts`. The deploy-pipeline
change (Part A) qualifies and warrants a minor bump to **3.16.0**. The changelog
entry must cover only the publish/deploy mechanics — how a merged submission
reaches production — and must not mention the taxonomy or UI changes in Part B,
which are site-rendering concerns outside the changelog's stated scope.

## Risks

- **Deploy cutover.** Disconnecting Git integration is an owner action on a live
  production site. Until `wrangler pages deploy` is verified working, the site
  has no automated deploy path. Mitigation: verify with `workflow_dispatch`
  against the real project before removing any fallback, and keep the manual
  Cloudflare deploy hook usable during the transition.
- **Loss of tag pages.** 4,402 tag pages and 1,657 source pages stop existing.
  Any that are indexed by search engines will start returning 404. This is
  intended — they are single-article thin content — but it is a visible change to
  the site's URL surface, and the sitemap must be updated in the same deploy so
  crawlers are not told about URLs that no longer exist.
- **GitHub Actions cache size.** The OG cache is roughly 211 MB. GitHub's 10 GB
  per-repository cache budget evicts least-recently-used entries, so a rolling
  per-run key will churn older entries. This is acceptable, but if cache
  restores start missing, shrinking the PNGs (they average 115 KB for flat-colour
  cards and should quantize well below that) is the follow-up lever.
