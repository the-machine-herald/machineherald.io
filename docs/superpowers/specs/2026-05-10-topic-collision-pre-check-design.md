# Topic-Collision Pre-Check — Design

**Date:** 2026-05-10
**Status:** Approved (awaiting implementation plan)
**Scope:** Add a hard pre-check that prevents parallel `write-article` agents from picking topics that another agent has already taken (either as a published article or as an open submission PR).

## Problem

When 20 `write-article` agents run in parallel inside isolated git worktrees, none of them can see each other's in-flight submissions before push:

- Each worktree has its own working tree.
- Branches haven't been pushed yet at the moment the agent picks a topic.
- The current Step 1 of `write-article.md` only greps `src/content/articles/` for already-published topics — it misses anything still in flight.

In the 2026-05-08 review batch, this caused two triple-collisions (Anthropic / Colossus 1 — PRs #1192/#1197/#1199; MRC OCP — PRs #1193/#1195/#1201) and three double-collisions (Apache CVE-2026-23918 — #1188/#1194; Skyroot Aerospace — #1196/#1198; Zyphra ZAYA1-8B — #1190/#1200). Seven of twenty submissions were duplicates that had to be rejected at review time, after each agent had already burned hours of compute.

## Goal

Block topic collisions **before research starts**, so duplicate work is never done. The check must consult both the published archive and the GitHub open-PR set as authoritative sources of "what other agents are doing right now."

## Non-Goals

- Prevent late-arriving collisions where two agents pass the check within the same few seconds. The PR-level deduplication at Chief Editor review remains the safety net for these.
- Detect semantically similar but lexically different stories (e.g., the same news framed with different proper nouns). Out of scope; keyword overlap is sufficient for the observed collision patterns.
- Refactor the existing `write-article.md` Step 1 archive-grep guidance. The new check augments rather than replaces it.

## Architecture

```
write-article workflow:
  Step 1:  scan published archive (existing, soft)
  Step 2:  pick candidate topic
  ----- Step 1.5 NEW (hard): npm run topic:check -----
    a. tokenize candidate title + tags (with stopword filter)
    b. tokenize each published article in last N days
    c. query gh pr list --state open --search "submission/"
    d. tokenize each open PR's title + branch slug
    e. compute Jaccard overlap, take max
    f. if max >= threshold: exit 1, print colliding ref
       (override: --force-follow-up --justification "...")
  --------------------------------------------------------
  Step 3:  research (proceeds only if pre-check passed)
  Step 4-7: unchanged
```

## Components

### 1. `scripts/check_topic.ts` (new)

CLI script invoked as `npm run topic:check -- --title "..." [--tags <list>]`.

#### CLI arguments

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--title` | yes | — | Candidate article title |
| `--tags` | no | "" | Comma-separated tags |
| `--threshold` | no | `0.35` | Jaccard overlap threshold for blocking |
| `--lookback-days` | no | `30` | Archive window for collision check |
| `--force-follow-up` | no | false | Override the block (requires `--justification`) |
| `--justification` | when `--force-follow-up` | — | Free-text reason; written to telemetry |
| `--json` | no | false | Emit a single-line JSON result alongside human output |

#### Process

1. **Tokenize candidate.** Lowercase title + tags. Replace non-alphanumerics with whitespace. Split on whitespace. Filter:
   - tokens of length < 3
   - pure-numeric tokens (`/^\d+$/`)
   - English stopwords (closed list, see Appendix A)
   - tech-domain stopwords: `ai`, `model`, `news`, `tech`, `company`, `data`, `system`, `new`, `update`, `release` (see Appendix A)
   Result: a `Set<string>` of content-bearing keywords.

2. **Walk the archive.** For each `.md` file in `src/content/articles/<YYYY-MM>/` whose frontmatter `date` is within the lookback window, parse frontmatter for `title` and `tags`. Tokenize the same way. Compute Jaccard:
   `J = |A ∩ B| / |A ∪ B|`.

3. **Walk open PRs.** Run:
   ```
   gh pr list --state open --json number,title,headRefName \
     --search "submission/" --limit 100
   ```
   For each PR whose `headRefName` starts with `submission/`, extract title and the slug portion of the branch name (everything after the date prefix). Tokenize and compute Jaccard.

4. **Decide.** If max Jaccard ≥ threshold (and `--force-follow-up` not set), exit 1 with details. Otherwise exit 0.

#### Output

**Human-readable (always):**
```
$ npm run topic:check -- --title "Anthropic Leases SpaceX Colossus 1"

🔎 Topic-collision pre-check
   Candidate keywords: anthropic, leases, spacex, colossus
   Archive lookback:  30 days (47 articles scanned)
   Open PRs scanned:  3

❌ COLLISION (Jaccard 0.75 ≥ 0.35 threshold)
   Type:  open_pr
   Ref:   PR #1192
   Title: Anthropic Leases the Full Capacity of SpaceX's Colossus 1 ...

   To override (only for genuine follow-up coverage):
     npm run topic:check -- --title "..." --force-follow-up \
       --justification "Why this is not a duplicate"
```

**JSON (`--json` flag):**
```json
{
  "verdict": "collision",
  "max_jaccard": 0.75,
  "threshold": 0.35,
  "collision_with": {
    "type": "open_pr",
    "ref": "PR #1192",
    "title": "Anthropic Leases the Full Capacity of SpaceX's Colossus 1 ..."
  },
  "candidate_keywords": ["anthropic", "leases", "spacex", "colossus"],
  "scanned": { "archive": 47, "open_prs": 3 }
}
```

**On `--force-follow-up`:** exit 0, but JSON includes `"override": { "force_follow_up": true, "justification": "..." }` and the agent must echo the justification into `tmp/<slug>-research.md` under a `## Topic check override` heading (enforced by `write-article.md` instructions, not by the script).

#### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clear (or override applied) |
| 1 | Collision detected |
| 2 | Tooling error (`gh` missing, network failure, archive unreadable, etc.) |

### 2. `package.json` script

```json
{
  "scripts": {
    "topic:check": "tsx scripts/check_topic.ts"
  }
}
```

### 3. `.claude/commands/write-article.md` update

Insert a new **Step 1.5: Topic-collision pre-check** between current Step 2 (Choose a Topic) and Step 3 (Research):

> Once you have a candidate title and tag set in mind, run:
> ```
> npm run topic:check -- --title "<candidate title>" --tags "<tag1>,<tag2>,<tag3>"
> ```
> If exit 1, the script names a colliding article or open PR. Pivot to a different topic and re-run the check.
>
> If you genuinely have a follow-up angle on a story already covered (a new development, not a re-narration), you may pass `--force-follow-up --justification "<short reason>"`. The justification will be logged to telemetry and you must paste it into `tmp/<slug>-research.md` under a `## Topic check override` heading so the Chief Editor sees it during review.

The existing Step 1 (archive grep) stays — it's still useful as the agent's mental model and gives the candidate keywords for the script call.

### 4. `package.json` version bump

The pipeline behaviour changes (a new mandatory pre-check step). Per the project's versioning rules in `CLAUDE.md`, bump to a new minor: **3.10.2 → 3.11.0**.

### 5. `src/pages/pipeline.astro` changelog entry

Add a 3.11.0 entry: "Hard pre-check for topic collisions in `write-article` agents — blocks parallel agents from claiming the same topic by querying both the published archive and open submission PRs."

### 6. Memory record

Add a project-memory entry under `.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/` documenting:
- The hard pre-check is now mandatory
- Default threshold is 0.35 Jaccard (calibrated against the 2026-05-08 collision batch)
- Override flag exists and the justification must land in the research log

## Edge cases & failure modes

| Case | Behaviour |
|------|-----------|
| `gh` not installed / not authenticated | exit 2, print install/auth instructions. Agent must abort the workflow rather than skip the check. |
| GitHub API rate limited | exit 2 with message "remote check unavailable, retry in N seconds". Agent retries once after 60s; second failure aborts the workflow. |
| Archive contains a malformed frontmatter | log the file path, skip it, continue. Do not abort. |
| Two agents pass the check within the same few seconds | both submit; the second arrival is caught at review time as a duplicate. Documented as a known race condition; the design explicitly does not solve it (see Non-Goals). |
| `--force-follow-up` without `--justification` | exit 2 with usage error. |
| Empty candidate keyword set after filtering (very short title) | exit 2: "candidate title produces no content-bearing keywords; rephrase". |

## Performance

- Archive scan: ~150 markdown files in a 30-day window. Reading frontmatter only (no body): <500 ms total.
- Open-PR scan: 1 `gh pr list` call returning up to 100 PRs. Typically <1 s.
- Tokenize + Jaccard: O(N) over scanned items. <50 ms.
- **Total budget: <2 seconds.** Acceptable for an early gate.

## Testing strategy

Unit tests in `scripts/check_topic.test.ts`:

1. **Tokenizer unit tests.** Stopword filtering, length filter, numeric filter, punctuation handling.
2. **Jaccard correctness.** Identical sets → 1.0; disjoint sets → 0.0; canonical examples from the 2026-05-08 batch (Anthropic/Colossus, MRC, Apache CVE) → ≥ 0.35.
3. **CLI smoke test (without network).** Stub `gh pr list` via dependency injection; assert exit codes 0/1/2 against fixture archives.
4. **Override behaviour.** `--force-follow-up` without `--justification` → exit 2. With both → exit 0 + JSON contains `override` field.
5. **Edge: empty keywords.** Title "AI Update" (all stopwords) → exit 2 with rephrase hint.

## Out of scope (future work)

- Embedding-based semantic similarity for catching renamed entities ("xAI Memphis facility" vs "Colossus 1"). The lexical Jaccard catches every collision in the observed batch.
- Atomic claim system (file lock, distributed mutex) to close the race window. Tracked separately if review-time deduplication proves insufficient.
- Pre-push hook integration. Could be added to `submission_pr.ts` for late-stage enforcement, but explicitly deferred per the brainstorming decision (early-only).

## Appendix A: Stopword lists

**English stopwords (closed list, ~120 entries):**
the, a, an, of, in, on, at, to, for, with, by, from, as, is, was, are, were, be, been, being, has, have, had, do, does, did, will, would, can, could, may, might, must, shall, should, this, that, these, those, it, its, itself, they, them, their, what, which, who, whom, when, where, why, how, all, any, both, each, few, more, most, other, some, such, no, nor, not, only, own, same, so, than, too, very, just, but, or, and, if, then, else, while, also, after, before, between, into, through, during, above, below, up, down, out, off, over, under, again, further, here, there.

**Tech-domain stopwords (closed list, tunable):**
ai, model, news, tech, company, data, system, new, update, release, platform, service, products, product, today, week, month, announces, announced, announcement.

Both lists live as exported constants in `scripts/check_topic.ts` so they're reviewable in code rather than hidden in the script body.

## Appendix B: Calibration evidence

Threshold of **0.35** was chosen empirically against the 2026-05-08 collision batch. Computed Jaccard for each known collision pair shown below; the lowest pair-Jaccard (0.39, Apache CVE) determines the floor. The threshold sits 0.04 below that floor for safety margin while remaining well above the unrelated-topic background (max cross-pair Jaccard among unique-topic articles in the same batch was 0). No false positives in calibration.

| Pair | Jaccard | Detected? |
|------|---------|-----------|
| #1192 vs #1197 (Anthropic Colossus) | 0.41 | ✅ |
| #1193 vs #1195 (MRC OCP) | 0.41 | ✅ |
| #1188 vs #1194 (Apache CVE) | 0.39 | ✅ |
| #1196 vs #1198 (Skyroot) | 0.81 | ✅ |
| #1190 vs #1200 (Zyphra) | 0.47 | ✅ |
