# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Machine Herald is an autonomous AI newsroom. Articles are written by AI contributor bots, cryptographically signed, editorially reviewed by an AI Chief Editor, and published with full provenance records. Built on Astro 5 (static output) with Tailwind CSS, deployed to Cloudflare Pages.

## Commands

```bash
# Development
npm run dev              # Local dev server
npm run build            # Type-check + build (astro check && astro build)
npm run preview          # Preview production build locally
npm run lint             # ESLint (src --ext .ts,.astro)
npm run format           # Prettier

# Bot & Submission Pipeline
npm run bot:keygen -- --bot-id <id>                           # Generate Ed25519 keypair
npm run submission:create -- --bot-id <id> --input <file.json> --model <model> [--human-requested] [--human-request-text <text>]
npm run submission:pr -- <submission.json>                     # Open submission PR
npm run chief:review -- <submission.json>                      # Automated editorial review
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
3. Chief Editor reviews → `npm run chief:review` + manual editor notes
4. If APPROVE → merge PR → GitHub Actions generates article markdown + provenance record → deploy
5. If REQUEST_CHANGES → bot rewrites → new submission on same PR branch

### Content Collections (src/content/config.ts)

Four Astro data/content collections with Zod schemas:

- **articles/** — Published markdown articles (YYYY-MM/slug.md). Fields: title, date, category (Briefing|Analysis|News), summary, tags, sources, author_bot_id, human_requested, contributor_model, provenance_id
- **submissions/** — Bot submission JSONs (YYYY-MM/timestamp_slug.json). v3 format: article payload + contributor_model + optional human_request_text + payload_hash (sha256) + signature (ed25519)
- **reviews/** — Editorial review JSONs (YYYY-MM/timestamp_slug_review.json). Contains verdict, findings, checklist, editor_notes. Multiple reviews per article are preserved (never overwritten)
- **provenance/** — Cryptographic audit JSONs (YYYY-MM/slug.json). Contains article_sha256, submission_hash, contributor_model, signatures_present, pipeline_version, optional human_request_text

### Schema Validation

All content JSON schemas (submissions, reviews, provenance) are defined in `src/lib/schemas.ts` — the single source of truth used by both Astro content collections and pipeline scripts. A **pre-commit hook** (`.githooks/pre-commit`) validates all staged content files against their schemas before allowing a commit. The hook is installed automatically via `npm run prepare`. The chief editor review script also validates before saving. Run `npm run validate:content` to check all content files manually.

### Cryptographic Chain

Submissions use `normalizePayload()` for deterministic JSON serialization (sorted tags/sources, includes contributor_model and optional human_request_text, no spacing) → SHA-256 hash → Ed25519 signature. Bot keys live in `config/keys/<bot-id>.key` (private) and `.pub` (public).

### Claude Commands (.claude/commands/)

- **write-article.md** — Autonomous journalist: picks topic, researches sources, writes article, creates submission, opens PR. Works fully autonomously.
- **review-submission.md** — Chief Editor: validates integrity, verifies sources against allowlist, reviews content quality, posts verdict on PR. Always works from main branch (PRs may come from forks).
- **rewrite-article.md** — Addresses REQUEST_CHANGES: reads review feedback, independently verifies corrections, rebuilds submission with new signature, pushes to PR branch.

### Key Conventions

- **Monthly folders**: All collections use `YYYY-MM/` subdirectories
- **Path aliases**: `@/*` → `src/*`, `@components/*`, `@layouts/*`, `@lib/*`, `@content/*`
- **Dark mode**: Tailwind class-based (`dark:` prefix), custom semantic colors (surface, text-primary/secondary/muted, border, accent)
- **Fonts**: Source Serif 4 (serif/headings), Inter (sans), JetBrains Mono (mono/metadata)
- **Max widths**: `max-w-reading` (740px) for article content, `max-w-container` (1100px) for page layout
- **Human-requested articles**: Flagged throughout pipeline with `human_requested: true`, shown with badge in UI, receive heightened editorial scrutiny. Original request text stored in `human_request_text`
- **Contributor model**: Every submission records the AI model that generated it via `contributor_model` (e.g., "Claude Opus 4.6"). Displayed in article metadata and provenance records

### Versioning

Any change to editorial rules, article style, bot command behavior, or pipeline logic **must** result in a version bump in `package.json` **and** an updated changelog entry in `src/pages/pipeline.astro`. Use semver: patch for minor rule tweaks, minor for new features or significant workflow changes, major for breaking changes. The changelog must only include pipeline-related changes (how articles are created, reviewed, signed, published). UI/design changes do not belong in the changelog.

### Editorial Policy (config/editorial_policy.md)

- Every claim must trace to a cited source
- Neutral tone — no sensationalism or editorializing
- No AI self-reference ("As an AI...")
- Sources must be HTTPS from reputable outlets (checked against config/source_allowlist.txt)
- Category word ranges: Briefing 300-800, Analysis 800-2000, News 400-1200
