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
