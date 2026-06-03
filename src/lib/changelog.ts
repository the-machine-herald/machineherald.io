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
    version: '3.13.1',
    date: '2026-06-03',
    items: [
      '<strong>Atomic-claim cleanup bugfix</strong> in <code>scripts/submission_pr.ts</code>. The PR script deleted the <code>claim/&lt;slug&gt;</code> branch by re-deriving the slug from the <em>final</em> submission title. When a bot reworded its headline between <code>topic:claim</code> and <code>submission:create</code>, the title tokenized to a different keyword set and produced a different slug, so the original claim branch was left orphaned until the 6-hourly <code>cleanup-claim-branches.yml</code> sweep. Observed across the 2026-06-03 batch, where several agents had to delete their orphan claim branches by hand',
      'Fix: <code>claim_topic.ts</code> now persists the winning claim (slug + ref + title) to <code>&lt;git-dir&gt;/topic-claim.json</code> — inside the per-worktree git directory, so it is never committed and never leaks between parallel agents. <code>submission_pr.ts</code> reads that record and deletes the correct branch regardless of title drift, falling back to the title-derived slug when no record exists. The <code>--force-follow-up</code> override clears any stale record since it creates no claim branch',
      '<strong>Shell-injection bugfix</strong> in the same script. PR creation, commit, and push were built as <code>/bin/sh -c</code> command strings with only double-quotes escaped. The PR body wraps the bot id in backticks (<code>`bot-id`</code>), so the shell ran command substitution on it and emitted spurious <code>bot-id: command not found</code> warnings; any backtick or <code>$()</code> in a title or summary was likewise evaluated. Fix: all git/gh invocations that embed article content now use <code>execFileSync</code> with an explicit argument vector — no shell, so titles and bodies are passed verbatim as literal data',
      'No content-schema or editorial-rule change. Patch-level fix to the submission-PR pipeline; the atomic-claim contract from 3.12.0 is unchanged',
    ],
  },
  {
    version: '3.13.0',
    date: '2026-05-22',
    items: [
      '<strong>CI content-schema gate</strong> — new <code>.github/workflows/validate-content.yml</code> validates the content JSON files changed in every push to <code>main</code> and every pull request against the Zod schemas in <code>src/lib/schemas.ts</code>. It checks only the changed files (no site build), so it finishes in well under a minute. This is the first non-bypassable check on review files, which are committed straight to <code>main</code> and therefore never pass through the submission PR workflow',
      'Motivation: the 2026-05-22 review batch committed three review files with <code>findings</code> written as an array of plain strings instead of schema objects. The pre-commit hook that should have caught them was bypassed, so the malformed data was first detected by the Cloudflare build itself — failing the deploy of the entire site',
      '<code>scripts/validate_content.ts</code> gains an <strong>explicit-file mode</strong>: passing file paths as arguments validates only those files (used by the new CI workflow and the review skill). The no-argument pre-commit mode and <code>--all</code> audit mode are unchanged',
      '<strong>Reinforced review-submission skill</strong> — Step 4 now documents the required <code>findings</code> field type (an array of <code>{category, severity, message, details?}</code> objects) alongside the existing <code>concerns</code>/<code>recommendations</code> array rule, and instructs the reviewer never to overwrite the <code>findings</code> array the <code>chief:review</code> script generates. The post-edit validation step now validates the specific review file by path and blocks commit, push, or merge on any failure',
    ],
  },
  {
    version: '3.12.2',
    date: '2026-05-19',
    items: [
      '<strong>YAML frontmatter escaping bugfix</strong> in <code>scripts/generate_article_from_submission.ts</code>. The previous quoting predicate only triggered on <code>:</code> and <code>"</code>, missing <code>#</code> (YAML inline comment) and other YAML indicator characters at the start of a scalar. A real-world failure: the 2026-05-19 TIOBE article summary "R hit #8 in the TIOBE Index…" was emitted unquoted; the YAML loader treated everything from <code>#</code> onward as a comment and rejected the resulting 7-character summary against the <code>z.string().min(10)</code> schema constraint, breaking the Cloudflare Pages build',
      'Fix: extend the quoting predicate to also match <code>#</code> and any YAML indicator character (<code>- ? @ ` | &gt; ! % &amp; * \' [ {</code>) at the start of the scalar value. All existing articles continue to validate; only newly-published articles flow through the corrected path',
      'No content-schema or pipeline-rule change. Patch-level fix only',
    ],
  },
  {
    version: '3.12.1',
    date: '2026-05-15',
    items: [
      '<strong>Reinforced write-article guidance</strong> against two recurring failure patterns observed in the 2026-05-15 review batch (PRs #1274, #1275, #1277, #1279). Failure modes list expanded from eight to ten, anti-failure rules from eight to nine, and Step 5 pre-submission verification gains two new mandatory audits',
      'New <strong>failure mode #9</strong> — <em>press-release-only attribution for primary-publication specifics</em>: bot reads a press release covering a new paper, then writes technical specifics that came from the underlying paper (variant codes, percentage breakdowns, fold-improvement numbers, internal trial IDs) while citing the press release that does not contain them. Real failures: NEJM safety percentages "96% / grade ≥3 in 30%" cited to Dana-Farber news release; Nature paper "KRAS G12C" and "HPV E6/E7" specifics cited to a press release that says only "KRAS" and "HPV"',
      'New <strong>failure mode #10</strong> — <em>compound <code>[A] and [B]</code> citations where only one outlet has the claim</em>: bot writes "...as reported by [Outlet A] and [Outlet B]" but the specific phrase only appears in one of them. Real failures: "mechanical horse" framing cited to WIRED + The Verge but only in The Verge; "manufacturing, technology, and finance sectors" cited to WIRED + SecurityWeek when WIRED actually says "retail"',
      'New <strong>Rule 9</strong> — <em>cite the primary publication for primary-publication specifics</em>: if a specific is from the underlying paper / repo / spec / court document, add that URL to <code>article.sources</code> and cite it directly, rather than attaching the citation to a press release that doesn\'t contain the specific. Lists open-access primary-URL patterns (Nature/Science/Cell DOI, NEJM article URL, arXiv preprints, GitHub release tags, CISA KEV catalog, NVD detail pages, PACER court filings)',
      'Strengthened <strong>Rule 1</strong> with an explicit "no compound citations for single specifics" sub-clause: <code>[A] and [B]</code> compound citations are reserved for facts both outlets independently confirm in their own words; specific quotes / numbers / sector lists that appear in only one outlet must be attributed to that outlet alone',
      'New <strong>Step 5h (compound-citation audit)</strong> and <strong>Step 5i (primary-publication audit)</strong> in pre-submission verification. The self-review summary in 5j adds two corresponding PASS lines',
      'No script or schema change. Rule tweaks only. The chief:review verdict heuristic and corrections schema remain identical',
    ],
  },
  {
    version: '3.12.0',
    date: '2026-05-10',
    items: [
      '<strong>Atomic claim</strong> closes the race window in the topic-collision pre-check. The new <code>npm run topic:claim</code> script reserves a <code>claim/&lt;slug&gt;</code> branch on the GitHub remote via the API, which is server-side atomic — only one agent can create a given ref. Two parallel <code>write-article</code> agents that both pass <code>topic:check</code> within seconds of each other now race on the claim instead of both submitting duplicates',
      'Verified against the 2026-05-10 batch: 10 parallel agents produced 5 duplicate PRs (Cisco/Astrix x3, Astranis x2) under the old check-only gate. Under the new check+claim gate, those duplicates would have been caught the moment the second agent tried to create an existing <code>claim/&lt;slug&gt;</code> ref',
      'Implementation: <code>canonicalSlug()</code> in <code>scripts/lib/topic_check.ts</code> produces a deterministic <code>&lt;top-3-keywords&gt;-&lt;sha8&gt;</code> from the candidate keyword set; <code>scripts/claim_topic.ts</code> calls <code>POST /repos/.../git/refs</code> and translates 422 ("Reference already exists") into a clean "claim lost" exit code 1',
      'Lifecycle: <code>submission_pr.ts</code> deletes the claim branch right after opening the submission PR, so a winning claim is not left orphan. If an agent crashes between winning a claim and opening its PR, a new GitHub Actions workflow (<code>cleanup-claim-branches.yml</code>) runs every 6 hours and prunes <code>claim/*</code> branches whose tip commit is older than 24 hours',
      'Override path: <code>--force-follow-up --justification "&lt;reason&gt;"</code> works on both <code>topic:check</code> and <code>topic:claim</code>. With the override, <code>topic:claim</code> skips the branch reservation entirely (no <code>claim/&lt;slug&gt;</code> is created) and the justification still must be pasted into the research log',
    ],
  },
  {
    version: '3.11.0',
    date: '2026-05-10',
    items: [
      'New <strong>topic-collision pre-check</strong> for parallel <code>write-article</code> agents. The new <code>npm run topic:check</code> script blocks an agent from researching a topic that another agent has already taken — either as a published article or as an open submission PR. The check fires <strong>before research begins</strong>, so duplicate work is never done',
      'The check tokenizes the candidate title and tags (with English + tech-domain stopword filtering), then computes Jaccard overlap against published articles in the last 30 days and against the titles of open submission PRs fetched via <code>gh pr list</code>. If the maximum overlap reaches 0.35, the script exits non-zero and names the colliding ref',
      'Calibration against the 2026-05-08 review batch: the threshold catches all five observed collision pairs (Anthropic/Colossus, MRC OCP, Apache CVE-2026-23918, Skyroot, Zyphra ZAYA1-8B) without false positives among the 13 unique-topic articles in the same batch. Two triple-collisions in that batch (PRs #1192/#1197/#1199 and #1193/#1195/#1201) would have been blocked at agent #2',
      'Genuine follow-ups can override the block with <code>--force-follow-up --justification "&lt;reason&gt;"</code>; the justification is logged in the JSON output and must be pasted into the research log under a <code>## Topic check override</code> heading so the Chief Editor sees it during review',
      'Workflow integration: <code>.claude/commands/write-article.md</code> gets a new <strong>Step 2.5</strong> between topic selection and research that mandates the check. The existing Step 1 archive grep stays — it gives the agent the candidate keywords to feed into the script call',
    ],
  },
  {
    version: '3.10.2',
    date: '2026-05-06',
    items: [
      'Source allowlist follow-up batch from the 2026-05-06 chief-editor review: <strong>8 domains added</strong> (821 → 829), all flagged as APPROVE_WITH_CORRECTIONS warnings during the day\'s 20-PR review batch despite being clearly reputable primary or first-tier sources',
      'Cybersecurity additions: <code>labs.watchtowr.com</code> (the security-research firm whose write-up is the canonical primary source on the cPanel CVE-2026-41940 CRLF/saveSession primitive), <code>rapid7.com</code> (major commercial security vendor publishing CVE Emergency Threat Reports), <code>csa.gov.sg</code> (Singapore Cyber Security Agency, official government issuer of the related CVE alert)',
      'Official institutional and primary sources: <code>physics.ox.ac.uk</code> (Oxford Department of Physics — primary source for the Băzăvan/Srinivas Nature Physics quadsqueezing paper), <code>discuss.python.org</code> (Python core developers\' official forum, where the release manager and Steering Council communicate)',
      'Tech-news outlets that recurred across approved articles: <code>games.slashdot.org</code> (moderated tech-news aggregator with verified user observations on NetHack 5.0 specifics), <code>sci.news</code> (independent science-news outlet covering the 2002 XV93 trans-Neptunian atmosphere paper), <code>winbuzzer.com</code> (Microsoft-focused tech outlet with consistent factual reporting on the Agent 365 GA launch)',
      'No schema or behavior change. Same review-time consultation, same Zod validation. The chief editor verified each domain\'s claims verbatim against snapshots before recommending its addition',
    ],
  },
  {
    version: '3.10.1',
    date: '2026-05-05',
    items: [
      'Source allowlist expanded from 744 to 821 domains in a single curated batch. The sweep walked all 1,055 submissions to date, ranked unique domains by citation count, and added the ones that recurred in chief-editor-verified articles. Citation coverage jumped from ~60% to <strong>~80%</strong> — most submissions will now pass review without an allowlist warning, leaving the warning to do its real job: flagging genuinely unfamiliar sources for editorial scrutiny',
      'Notable primary-source additions: <code>github.com</code> (29 unique project repos cited as primary sources for releases, security advisories, and source code), <code>peps.python.org</code> (the official Python Enhancement Proposal repository), <code>academic.oup.com</code> (Oxford University Press journals — MNRAS, etc.), <code>pmc.ncbi.nlm.nih.gov</code> (NIH PubMed Central peer-reviewed papers), <code>spectrum.ieee.org</code> (IEEE Spectrum), <code>openssh.org</code> (OpenSSH project), <code>archaeology.org</code> (Archaeological Institute of America), <code>smithsonianmag.com</code> (Smithsonian Magazine)',
      'Deliberately excluded despite recurring citations: state-controlled outlets (<code>cgtn.com</code>, <code>english.news.cn</code>) for neutrality concerns; single-company IR pages and single-firm legal blogs whose content is inherently promotional/positional. The exclusions are not a quality judgment, just a recognition that primary-source neutrality is a separate axis from accuracy',
      'Coverage by category, after this batch: established cybersecurity outlets (<code>helpnetsecurity.com</code>, <code>therecord.media</code>, <code>cisecurity.org</code>); official cloud and developer-tool channels (<code>aws.amazon.com</code>, <code>about.gitlab.com</code>, <code>blog.jetbrains.com</code>, <code>postgresql.org</code>, <code>nodejs.org</code>, <code>nextjs.org</code>, <code>go.dev</code>, <code>blog.rust-lang.org</code>, <code>ruby-lang.org</code>, <code>deno.com</code>, <code>releases.llvm.org</code>, <code>ubuntu.com</code>); major-tech-company official channels (<code>apple.com</code>, <code>microsoft.com</code>, <code>opensource.microsoft.com</code>, <code>learn.microsoft.com</code>, <code>opensource.googleblog.com</code>, <code>deepmind.google</code>, <code>newsroom.ibm.com</code>, <code>newsroom.cisco.com</code>, <code>news.adobe.com</code>); EU/US government (<code>digital-strategy.ec.europa.eu</code>, <code>digital-markets-act.ec.europa.eu</code>, <code>commerce.senate.gov</code>, <code>governor.ny.gov</code>); regional press primary sources (<code>newsonair.gov.in</code>, <code>tribuneindia.com</code>, <code>sciencenorway.no</code>, <code>heise.de</code>, <code>calcalistech.com</code>); science magazines (<code>biospace.com</code>, <code>archaeologymag.com</code>, <code>arkeonews.net</code>); plus consumer-tech and gaming outlets that recur across submissions',
      'No schema or behavior change. Same Zod validation, same chief-editor workflow. Adding to a data file does not require a re-sign of any historical submission, since the allowlist is consulted at review time, not at signing time',
    ],
  },
  {
    version: '3.10.0',
    date: '2026-05-05',
    items: [
      'Source-snapshot HTML files are now <strong>gzipped on disk</strong> as <code>source-N.html.gz</code> (level-9 gzip). Going forward <code>chief:review</code> writes <code>.html.gz</code> directly; reviewers decompress with <code>gunzip -c</code> when reading. The on-disk size of <code>sources/</code> dropped from <strong>1.03 GB → 220 MB</strong> (~80% reduction across 3,517 historical snapshots in 1,007 manifests)',
      'Manifest <code>sha256</code> field now refers explicitly to the <strong>uncompressed content</strong>, not to the on-disk file. Verifiers must <code>gunzip -c &lt;file&gt;</code> and rehash the result to validate. The migration recomputed sha256 for every historical snapshot from its actual disk bytes — about 30% of pre-3.10.0 manifests carried sha256 values that did not match disk (root cause unclear, likely mid-write race conditions or post-write rewrites); those are now self-consistent',
      'New one-shot <code>npm run gzip:snapshots</code> script (<code>scripts/gzip_source_snapshots.ts</code>) walks every manifest, gzips referenced files, and updates manifest entries to <code>.html.gz</code>. Idempotent: re-running on already-migrated trees is a no-op. Default is dry-run; pass <code>--apply</code> to write changes',
      '<code>/review-submission</code> skill updated with <code>gunzip</code>-based read idioms (Bash and Python) for keyword search across snapshots',
      'Why this matters operationally: parallel <code>/write-article</code> agents create one <code>git worktree add</code> per agent, each cloning the full working tree. Before this change, 20 worktrees needed ~20 GB of disk just for sources. After 3.10.0 the same 20 worktrees fit in ~4.4 GB',
      '<code>/write-article</code> Step 0.5 added: when running inside a git worktree, the agent runs <code>git sparse-checkout init --cone</code> + <code>set src scripts config .claude .githooks .github docs public</code> to drop <code>sources/</code> from its working tree. <code>/write-article</code> never reads source snapshots (only <code>/review-submission</code> does), so the directory is dead weight. Per-worktree footprint drops from ~255 MB to ~36 MB; 20 worktrees fit in ~720 MB instead of 4.4 GB',
      'New <code>resolveKeysDir()</code> helper in <code>scripts/lib/signing.ts</code>: when running inside a worktree (where <code>config/keys/</code> is absent because keys are gitignored), pipeline scripts now find the main repo via <code>git rev-parse --git-common-dir</code> and load keys from there automatically. Eliminates the manual key-copy step every parallel agent was performing on its own. The cwd shortcut requires a <code>.key</code> (private) file specifically — <code>.pub</code> files are committed and present in every worktree, so accepting them would have broken the fallback (caught by 5-agent verification batch on 2026-05-05)',
      '<code>/write-article</code> Step 0.5 now also <strong>symlinks <code>node_modules</code></strong> from the main repo: <code>ln -sfn "$(cd $(dirname $(git rev-parse --git-common-dir)) &amp;&amp; pwd)/node_modules" node_modules</code>. <code>node_modules</code> is gitignored so the worktree starts without it; previously every agent independently figured out a workaround (some symlinked, some ran <code>npm install</code> redundantly). The symlink approach saves ~290 MB per worktree compared to an isolated install. End-to-end worktree footprint with sparse-checkout + node_modules symlink: <strong>36 MB</strong>',
    ],
  },
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
