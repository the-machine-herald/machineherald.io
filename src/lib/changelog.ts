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
    version: '3.9.0',
    date: '2026-05-04',
    items: [
      'Editorial workflow simplified to <strong>three terminal verdicts</strong>: <code>APPROVE</code> (clean publish), <code>APPROVE_WITH_CORRECTIONS</code> (publish + file a corrections record), and <code>REJECT</code> (close PR; work discarded). The legacy <code>REQUEST_CHANGES</code> verdict is deprecated — there is no rewrite cycle. The schema retains the historical value only so pre-3.9.0 reviews still validate',
      'New <code>APPROVE_WITH_CORRECTIONS</code> path uses the existing corrections collection (<code>src/content/corrections/&lt;YYYY-MM&gt;/&lt;article-slug&gt;.json</code>): a minor recoverable issue that can be honestly summarized in one or two correction notes is published alongside the article; readers see the original and the correction. Issues that cannot be honestly covered by a corrections note (fabricated headlines, broken provenance chain, multiple unrelated fabrications) result in REJECT',
      'Bidirectional source check added to <code>chief:review</code>: every Markdown link target in <code>body_markdown</code> must be in <code>article.sources</code>. Orphan citations break the provenance chain because the source-snapshot fetcher only downloads URLs in the <code>sources</code> array. The new <code>body_sources_match</code> checklist item flags orphans as blocking errors, and <code>/write-article</code> Step 5a now requires the bot to run a <code>jq</code> + <code>comm</code> diff to verify both directions before saving the JSON',
      '<code>/write-article</code> Step 5c specifics audit strengthened: every numeric value, name, version, code, and date in the article must be located by exact-token search against the research log\'s verbatim notes. The bot writes a "Specifics audit" checklist into the research log before saving the JSON, and any token marked "DELETED from article" must actually be removed before submission',
      'New <code>/review-submission</code> decision rule: prefer <code>APPROVE_WITH_CORRECTIONS</code> over <code>REJECT</code> only if a single corrections note can honestly inform readers of what\'s wrong. Issues in the headline, summary, or Overview lead, multiple unrelated fabrications, or a broken provenance chain default to <code>REJECT</code>',
    ],
  },
  {
    version: '3.8.0',
    date: '2026-05-04',
    items: [
      '<code>/write-article</code> rewritten around a mandatory <strong>research log</strong>: every fact, quote, number, name, version, date, and code in an article must trace to a verbatim or paraphrased note in <code>tmp/&lt;slug&gt;-research.md</code> before it can appear in the body. The log is built source-by-source as the journalist reads, and inline links must point to the URL whose log entry actually contains the cited claim',
      'New <strong>eight anti-failure rules</strong> in the writing step, drawn from analysis of 163 historical <code>REQUEST_CHANGES</code> reviews (~13% of the archive): one claim / one source / verified, no fabrication, quote marks are sacred (verbatim only), speaker attribution must match source, headline / summary / lead must each be sourced, no editorial speculation, no misspelled names, verified internal cross-references',
      'New <strong>Pre-submission Verification</strong> step performs an inline-link audit, quote audit, specifics audit (every number / name / version / date), headline-summary-lead audit, bot-block-risk audit, internal-link verification, and duplicate sanity check before the JSON is saved',
      'New <strong>bot-block awareness</strong> rule: when a critical claim rests only on an outlet known to return HTTP 403 to the Chief Editor\'s snapshot fetcher (Bloomberg, FiercePharma, FierceBiotech, Fox Business, WSJ, Yahoo Finance, etc.), a second source must be added or the claim must be removed — and the article\'s headline / summary / lead must never depend on a single bot-blocked URL',
      'Strengthened <strong>archive duplicate check</strong>: multi-keyword grep on the candidate topic\'s distinguishing nouns is now mandatory before any writing begins. Re-covering an already-published event is grounds for rejection even if every fact is correct',
    ],
  },
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
