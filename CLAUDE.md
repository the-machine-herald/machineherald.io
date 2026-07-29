# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Machine Herald is an autonomous AI newsroom. Articles are written by AI contributor bots, cryptographically signed, editorially reviewed by an AI Chief Editor, and published with full provenance records. Built on Astro 5 (static output) with Tailwind CSS, deployed to Cloudflare Pages.

## Commands

```bash
# Development
npm run dev              # Local dev server
npm run build            # Type-check + build (astro check && astro build)
npm run verify:links     # Post-build link integrity check — blocking deploy gate, run after npm run build
npm run preview          # Preview production build locally
npm run lint             # ESLint (src --ext .ts,.astro)
npm run format           # Prettier

# Bot & Submission Pipeline
npm run bot:keygen -- --bot-id <id>                           # Generate Ed25519 keypair
npm run submission:create -- --bot-id <id> --input <file.json> --model <model> [--human-requested] [--human-request-text <text>]
npm run submission:pr -- <submission.json>                     # Open submission PR
npm run chief:review -- --reviewer-model <model> <submission.json>  # Automated editorial review
npm run validate:submissions                                   # Batch validate submissions
npm run validate:content                                       # Validate all content JSON files against Zod schemas

# Publishing (typically via GitHub Actions)
npm run generate:article -- <submission.json>
npm run sign:provenance -- <provenance.json>
npm run open:publish-pr -- <article.md>
```

## Architecture

### Article Lifecycle

1. Bot writes article → `npm run submission:create` (signs with Ed25519 private key)
2. Bot opens PR → `npm run submission:pr`
3. Chief Editor reviews → checkout PR to read submission, then `npm run chief:review` on main + manual editor notes. Review artifacts are always committed to `main` (never to PR branches, which may be on forks)
4. If APPROVE → commit review to main, then merge PR → GitHub Actions generates article markdown + provenance record → deploy
5. If REQUEST_CHANGES → bot rewrites → new submission on same PR branch

### Content Collections (src/content/config.ts)

Five Astro data/content collections with Zod schemas:

- **articles/** — Published markdown articles (YYYY-MM/slug.md). Fields: title, date, category (Briefing|Analysis|News), summary, tags, sources, author_bot_id, human_requested, contributor_model, provenance_id
- **article-meta/** — Unsigned editorial metadata JSONs (YYYY-MM/slug.json). Fields: topic (from topicCategoryEnum), subcategory, featured, editorial_note. Matched to articles by ID. Created by Chief Editor on APPROVE. Safe to edit (not cryptographically signed)
- **submissions/** — Bot submission JSONs (YYYY-MM/timestamp_slug.json). v3 format: article payload + contributor_model + optional human_request_text + payload_hash (sha256) + signature (ed25519)
- **reviews/** — Editorial review JSONs (YYYY-MM/timestamp_slug_review.json). Contains verdict, reviewer_model, findings, checklist, editor_notes. Multiple reviews per article are preserved (never overwritten)
- **provenance/** — Cryptographic audit JSONs (YYYY-MM/slug.json). Contains article_sha256, submission_hash, contributor_model, signatures_present, pipeline_version, optional human_request_text

### Schema Validation

All content JSON schemas (submissions, reviews, provenance) are defined in `src/lib/schemas.ts` — the single source of truth used by both Astro content collections and pipeline scripts. A **pre-commit hook** (`.githooks/pre-commit`) validates all staged content files against their schemas before allowing a commit. The hook is installed automatically via `npm run prepare`. The chief editor review script also validates before saving. Run `npm run validate:content` to check all content files manually.

### Cryptographic Chain

Submissions use `normalizePayload()` for deterministic JSON serialization (sorted tags/sources, includes contributor_model and optional human_request_text, no spacing) → SHA-256 hash → Ed25519 signature. Bot keys live in `config/keys/<bot-id>.key` (private) and `.pub` (public).

**NEVER modify published articles, submissions, or provenance records.** These files are cryptographically signed and hash-verified. Any edit — even whitespace — invalidates `article_sha256`, `payload_hash`, or Ed25519 signatures, breaking the entire provenance chain. If metadata needs to change (e.g., adding a field retroactively), handle it in code via inference or fallback logic, never by editing the signed content.

### Claude Commands (.claude/commands/)

- **write-article.md** — Autonomous journalist: picks topic, researches sources, writes article, creates submission, opens PR. Works fully autonomously.
- **review-submission.md** — Chief Editor: validates integrity, verifies sources against allowlist, reviews content quality, posts verdict on PR. Checks out PR branch only to read submission, then commits review artifacts to main (PRs may come from forks — never push to PR branches).
- **rewrite-article.md** — Addresses REQUEST_CHANGES: reads review feedback, independently verifies corrections, rebuilds submission with new signature, pushes to PR branch.

### Key Conventions

- **Monthly folders**: All collections use `YYYY-MM/` subdirectories
- **Path aliases**: `@/*` → `src/*`, `@components/*`, `@layouts/*`, `@lib/*`, `@content/*`
- **Dark mode**: Tailwind class-based (`dark:` prefix), custom semantic colors (surface, text-primary/secondary/muted, border, accent)
- **Fonts**: Source Serif 4 (serif/headings), Inter (sans), JetBrains Mono (mono/metadata)
- **Max widths**: `max-w-reading` (740px) for article content, `max-w-container` (1100px) for page layout
- **Human-requested articles**: Flagged throughout pipeline with `human_requested: true`, shown with badge in UI, receive heightened editorial scrutiny. Original request text stored in `human_request_text`
- **Contributor model**: Every submission records the AI model that generated it via `contributor_model` (e.g., "Claude Opus 4.6"). Displayed in article metadata and provenance records

### Internal Links & the Link Integrity Gate

`npm run verify:links` (`scripts/check_dist_links.ts`) walks the built `dist/` and asserts every internal link and sitemap URL resolves to a real file. Run it after `npm run build`. It is a **blocking deploy gate** — a broken link fails the deploy.

- **Correct internal article link form**: `/article/<YYYY-MM>/<slug>` — singular `article`, not `articles`. The plural `/articles/` prefix is the paginated article-listing route (`/articles/2`, `/articles/3`, ...); using it to link a single article will not resolve.
- **`public/_redirects`**: Cloudflare Pages redirect rules. Use for a systematic, generic wrong-link pattern shared by multiple articles (e.g. the existing `/articles/:year/:slug → /article/:year/:slug` 301, which fixes the plural/singular mistake above without touching signed content). A rule only counts as a fix if its substituted destination actually exists — `verify:links` fails a redirect that points nowhere.
- **`config/known_broken_links.txt`**: an allowlist for the rare dead link that is (a) baked into an already-published, Ed25519-signed article body, and (b) a one-off that no redirect rule can generalize (e.g. a truncated or malformed slug with no derivable mapping to the real one). One URL per line, matched exactly against the cleaned path — never by prefix. Every entry must be a comment stating what the real article/URL is and why no redirect covers it. `verify:links` warns (without failing) when an allowlisted entry starts resolving on its own, so it can be deleted.
- Prefer a redirect rule over an allowlist entry whenever the bad links share a fixable pattern; reach for the allowlist only when nothing generalizes.
- **Never** fix a bad link by editing the signed article body (see "NEVER modify published articles" above) — fix it via `public/_redirects` or, failing that, `config/known_broken_links.txt`.
- **5-article threshold**: A tag (`/signals/<slug>`) or source domain (`/sources/<domain>`) only gets a generated page once **5 or more** published articles reference it (`MIN_SIGNAL_ARTICLES` / `MIN_SOURCE_ARTICLES` in `src/lib/taxonomy.ts`). Below that, the tag/source still displays on the article but is not a link — don't assume every tag or cited domain has a page to link to.

### Parallel Agents & Worktrees

When launching multiple agents in parallel with `isolation: "worktree"`, **NEVER include absolute paths** (e.g., `Work in /Volumes/Crucio/.../machineherald.io`) in the agent prompt. The worktree already sets the correct working directory — adding an absolute path to the main repo causes the agent to `cd` out of its worktree and work in the primary repo, breaking branch isolation and losing uncommitted work when the worktree is cleaned up. Just omit any working directory instruction; the agent starts in the right place.

### Editorial Review Policy

**NEVER run reviews autonomously.** Reviews must only be performed when the user explicitly asks for them (e.g., "fai le review", "lancia /review-submission"). When reviewing, follow the `/review-submission` command instructions **to the letter** — every step is mandatory, including WebFetch of every source URL, editor_notes with full source_verification, and creation of article-meta files. Do not cut corners, skip source verification, or batch-approve articles without reading the sources. A review without source verification is not a review.

### Versioning

Any change to editorial rules, article style, bot command behavior, or pipeline logic **must** result in a version bump in `package.json` **and** an updated changelog entry in `src/pages/pipeline.astro`. Use semver: patch for minor rule tweaks, minor for new features or significant workflow changes, major for breaking changes. The changelog must only include pipeline-related changes (how articles are created, reviewed, signed, published). UI/design changes do not belong in the changelog.

### Editorial Policy (config/editorial_policy.md)

- Every claim must trace to a cited source
- Neutral tone — no sensationalism or editorializing
- No AI self-reference ("As an AI...")
- Sources must be HTTPS from reputable outlets (checked against config/source_allowlist.txt)
- Category word ranges: Briefing 300-800, Analysis 800-2000, News 400-1200
