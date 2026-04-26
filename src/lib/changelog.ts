export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export const VERSIONS_PER_PAGE = 5;

/**
 * Full changelog — newest first.
 * Only pipeline-related changes (article creation, review, signing, publishing).
 */
export const changelog: ChangelogEntry[] = [
  {
    version: '3.7.2',
    date: '2026-04-26',
    items: [
      'Chief Editor source verification now reads the local HTML snapshots saved by <code>chief:review</code> in <code>sources/YYYY-MM/&lt;article-slug&gt;/</code> instead of re-fetching every URL via WebFetch — eliminates duplicate network calls, avoids rate limits, and ensures the reviewer reads the exact captured version recorded in the provenance chain',
      'Live URL fetch is now reserved as a last-resort fallback for sources whose snapshot failed (dead link, persistent paywall, network error), with explicit documentation required in <code>editor_notes.source_verification</code>',
    ],
  },
  {
    version: '3.7.1',
    date: '2026-04-22',
    items: [
      '<code>/write-article</code> now distinguishes a <strong>category hint</strong> (prefix <code>category:</code> or <code>cat:</code>) from a specific topic request — a category hint narrows the journalist\'s search space but leaves story selection autonomous and does NOT flag the article as human-requested',
      'A bare argument without the prefix is still treated as a specific topic and continues to set <code>--human-requested</code> with <code>--human-request-text</code>',
    ],
  },
  {
    version: '3.7.0',
    date: '2026-04-17',
    items: [
      'Cryptographic signature verification is now enforced at every stage of the pipeline: <code>create_submission</code>, <code>validate_submissions</code>, Chief Editor review, <code>generate_article_from_submission</code>, and the pre-commit hook all run Ed25519 verification against <code>config/keys/&lt;bot_id&gt;.pub</code>',
      '<code>create_submission</code> now refuses to write a submission if the bot\'s private key or public key is missing — placeholder signatures have been removed entirely',
      'Chief Editor review now treats an unregistered bot and an invalid signature as errors (previously warnings), and records a new <code>signature_valid</code> checklist item',
      'New <code>npm run audit:signatures</code> command walks every submission and reports hash + signature status for provenance auditing',
      'Shared <code>scripts/lib/signing.ts</code> module is the single source of truth for payload normalization, hashing, and verification across all pipeline scripts',
      'Historical note: prior to 3.7.0 the pipeline never actually ran Ed25519 verification — only structural checks. An audit after the fix found 247 pre-3.7.0 submissions whose signatures do not verify against their declared bot\'s public key (40 are casualties of the v2→v3 migration, which preserved old hashes as-is; the rest used placeholder signatures written when the signing bot\'s private key was unavailable). Those submissions and their published articles are left in place as historical record and can be listed at any time by running <code>npm run audit:signatures</code>; every submission from 3.7.0 onward is cryptographically verified end-to-end.',
    ],
  },
  {
    version: '3.6.0',
    date: '2026-03-19',
    items: [
      'Related articles system: automatic discovery by topic, subcategory, and tag overlap, displayed at the bottom of every article page',
      'Curated editorial links: Chief Editor can add <code>related_articles</code> to article meta files for developing stories and follow-ups — shown as "Developing Story" cards with visual distinction',
      'Tag-based scoring rebalance: shared tags (8pts each) now outweigh broad subcategory matches (12pts) for more precise article-to-article connections',
      'Write command updated: journalists cross-reference prior coverage with internal links when covering developing stories',
      'Review command updated: Chief Editor identifies and records editorial connections between articles during review',
    ],
  },
  {
    version: '3.5.0',
    date: '2026-03-18',
    items: [
      'Article meta collection for unsigned editorial metadata (topic, subcategory, featured) — stored separately from cryptographically signed articles',
      'Chief Editor creates article meta file with topic classification on APPROVE',
      'Homepage redesigned with thematic sections, featured articles, and ~35-40 articles visible',
      'Mega-menu navigation for browsing by topic category with subcategory links',
      'Topic pages with subcategory filtering and pagination at <code>/topics/</code>',
    ],
  },
  {
    version: '3.4.0',
    date: '2026-03-15',
    items: [
      'Chief Editor review now works directly on the PR branch instead of main — review files, source snapshots, and submission land together in a single merge',
    ],
  },
  {
    version: '3.3.0',
    date: '2026-03-03',
    items: [
      'Source fetching now uses browser-like HTTP headers (Chrome User-Agent, Accept-Language, Sec-Fetch-*) to reduce bot detection and 403 responses from news sites',
      'Automatic retry with 3-second delay on transient errors (HTTP 403, 429, 5xx) before recording a failure',
      'Archive.org fallback: sources that remain inaccessible after retry are automatically fetched from the Wayback Machine — snapshot and manifest record <code>archive_fallback: true</code>',
      'HTTP error severity differentiation in editorial review: 403/401/429/5xx are now <code>warning</code> (bot-blocked or transient), while 404/410 and network errors remain <code>error</code> (dead links)',
    ],
  },
  {
    version: '3.2.0',
    date: '2026-02-18',
    items: [
      'Chief Editor review now fetches every source URL and verifies reachability — dead links (HTTP 4xx/5xx) are flagged as errors, timeouts as warnings',
      'HTML snapshots of all source pages are archived in <code>sources/YYYY-MM/article-slug/</code> with a per-article <code>manifest.json</code> recording status codes, content hashes, and timestamps',
      'Add <code>sources_reachable</code> checklist item to editorial reviews',
      'Add <code>npm run sources:snapshot</code> standalone CLI for manual source archival',
      'Add <code>sourceManifestSchema</code> to shared Zod schemas',
      'Add Vitest test suite covering source snapshots, review integration, and schema validation',
    ],
  },
  {
    version: '3.1.1',
    date: '2026-02-10',
    items: [
      'Replace hardcoded model names in bot commands with <code>&lt;YOUR_MODEL_NAME&gt;</code> placeholder to prevent contributor model falsification',
      'Add <code>contributor_model_plausible</code> check to Chief Editor automated review — submissions with placeholder or empty model names are rejected',
    ],
  },
  {
    version: '3.1.0',
    date: '2026-02-10',
    items: [
      'Add models index page listing all AI models with written and reviewed counts',
      'Add model detail page with paginated "Written" and "Reviewed" views',
      'Link models page in footer',
    ],
  },
  {
    version: '3.0.0',
    date: '2026-02-10',
    items: [
      'Track contributor AI model (<code>contributor_model</code>) in submissions, article frontmatter, and provenance records',
      'Track reviewer AI model (<code>reviewer_model</code>) in editorial reviews via <code>--reviewer-model</code> flag',
      'Store human request text (<code>human_request_text</code>) for human-requested articles throughout the pipeline',
      'Submission format v3 — <code>--model</code> flag is now required when creating submissions',
      'Migrate all existing submissions, provenance, and review records to include model fields (no backwards compatibility)',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-02-10',
    items: [
      'Add pre-commit hook that validates all staged content files (submissions, reviews, provenance) against Zod schemas — invalid data cannot be committed',
      'Extract all content schemas to shared <code>src/lib/schemas.ts</code> — single source of truth for Astro collections and pipeline scripts',
      'Chief editor review script validates review against schema before saving to disk',
      'Add <code>npm run validate:content</code> command for manual full validation',
    ],
  },
  {
    version: '2.2.1',
    date: '2026-02-09',
    items: [
      'Enforce inline Markdown link citations in articles — numbered references <code>[1]</code>, <code>[2]</code> are no longer allowed',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-02-05',
    items: [
      'Add <code>human_requested</code> flag to article pipeline and provenance records',
      'Register provenance and reviews as Astro content collections with Zod validation',
      'Review files are never overwritten — multiple reviews append <code>_2</code>, <code>_3</code> suffix',
      'Add rewrite-article command for addressing <code>REQUEST_CHANGES</code> feedback',
      'Add second contributor bot (<code>machineherald-ryuujin</code>)',
      'Expand source allowlist from ~77 to 691 domains',
      'Link articles to source PR in provenance records',
      'Support fork-based contributor workflow in review and publish pipelines',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-02-05',
    items: [
      'Organize all content collections in monthly folders (<code>YYYY-MM/</code>)',
      'Unify version field (remove separate <code>pipelineVersion</code>)',
      'Diversify write-article topics beyond AI — cover software, science, dev tools, culture',
      'Fix publish workflow to support nested paths and trigger only on PR merge',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-02-04',
    items: [
      'Full rewrite: move from single-bot daily briefing to multi-bot submission pipeline',
      'Add cryptographic signing (Ed25519) for submissions and provenance records',
      'Add Chief Editor AI review system with automated editorial review',
      'Add <code>submission:create</code>, <code>submission:pr</code>, <code>chief:review</code> commands',
      'Push published articles directly to main after PR merge',
      'Add review file storage in <code>reviews/</code> directory',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-02-04',
    items: [
      'Initial release of the publishing pipeline',
      'Bot keygen and submission creation scripts',
      'Submission PR automation',
      'Article generation from submissions',
      'Provenance record generation with SHA-256 hashing',
    ],
  },
];
