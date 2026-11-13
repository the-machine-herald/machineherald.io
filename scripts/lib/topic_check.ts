/**
 * Topic-check helpers.
 *
 * Pure-logic utilities — stopwords, tokenize, jaccard, scoreCandidate,
 * walkArchive, parseOpenPRs — consumed by scripts/check_topic.ts to detect
 * whether a proposed article topic is too similar to recently published or
 * in-flight work.
 */

// scripts/lib/topic_check.ts

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Closed-list English stopwords for keyword extraction.
 * Reviewable here rather than hidden inside a regex.
 */
export const ENGLISH_STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'must',
  'shall', 'should', 'this', 'that', 'these', 'those', 'it', 'its', 'itself',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'but', 'or', 'and', 'if', 'then', 'else', 'while',
  'also', 'after', 'before', 'between', 'into', 'through', 'during', 'above',
  'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
  'here', 'there',
]);

/**
 * Tech-domain stopwords that recur in titles without distinguishing topics.
 * Tunable. Add tokens here when you observe Jaccard inflation from generic terms.
 */
export const TECH_STOPWORDS = new Set<string>([
  'ai', 'model', 'news', 'tech', 'company', 'data', 'system', 'new', 'update',
  'release', 'platform', 'service', 'products', 'product', 'today', 'week',
  'month', 'announces', 'announced', 'announcement',
]);

export const ALL_STOPWORDS = new Set<string>([
  ...ENGLISH_STOPWORDS,
  ...TECH_STOPWORDS,
]);

/**
 * Fold a token to a rough stem so that "plugins", "installed" and "installs"
 * compare equal to "plugin" and "install". Deliberately crude: it only has to
 * make two writers' wordings of the same story overlap, and it is applied to
 * both sides of every comparison (and to claim-branch keywords), so a wrong
 * stem is harmless as long as it is consistent.
 */
export function foldToken(tok: string): string {
  if (tok.length > 5 && tok.endsWith('ies')) return `${tok.slice(0, -3)}y`;
  if (tok.length > 6 && tok.endsWith('ing')) return tok.slice(0, -3);
  if (tok.length > 4 && /(xes|ches|shes|sses|zes)$/.test(tok)) return tok.slice(0, -2);
  if (tok.length > 5 && tok.endsWith('ed')) return tok.slice(0, -2);
  if (tok.length > 4 && tok.endsWith('s') && !/(ss|us|is)$/.test(tok)) return tok.slice(0, -1);
  return tok;
}

/**
 * Extract content-bearing tokens from a title (and optional tags).
 *
 * Rules:
 *  - lowercase
 *  - replace non-alphanumeric with whitespace, split, dedupe
 *  - drop tokens whose length < 3
 *  - drop pure-numeric tokens (/^\d+$/)
 *  - fold plurals and common verb endings (foldToken)
 *  - drop English + tech stopwords (checked before and after folding)
 */
export function tokenize(title: string, tags: string[] = []): Set<string> {
  const combined = [title, ...tags].join(' ').toLowerCase();
  const raw = combined.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const result = new Set<string>();
  for (const tok of raw) {
    if (tok.length < 3) continue;
    if (/^\d+$/.test(tok)) continue;
    if (ALL_STOPWORDS.has(tok)) continue;
    const folded = foldToken(tok);
    if (folded.length < 3 || ALL_STOPWORDS.has(folded)) continue;
    result.add(folded);
  }
  return result;
}

/**
 * Jaccard similarity coefficient: |A ∩ B| / |A ∪ B|.
 * Returns 0 when both sets are empty (avoids NaN).
 */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export interface Candidate {
  title: string;
  tags?: string[];
}

export type CorpusItemType = 'open_pr' | 'published_article' | 'claim';

export interface CorpusItem {
  type: CorpusItemType;
  ref: string;          // e.g. "PR #1192" or "2026-05/08-anthropic-leases-..."
  title: string;
  tags?: string[];
}

export interface Neighbor {
  type: CorpusItemType;
  ref: string;
  title: string;
  jaccard: number;
  shared: number;       // keywords the candidate and the item have in common
  containment: number;  // shared / size of the smaller keyword set
}

export type Verdict = 'clear' | 'collision' | 'empty_candidate';

export interface ScoreResult {
  verdict: Verdict;
  max_jaccard: number;
  threshold: number;
  collision_with?: Neighbor;
  collision_reason?: 'jaccard' | 'overlap';
  neighbors: Neighbor[];      // top 3 by Jaccard, descending
  candidate_keywords: string[];
}

const TOP_N_NEIGHBORS = 3;

/**
 * Second collision test. A short claim phrase ("Rust 1.100 stabilizes never
 * type") scores low Jaccard against a long published title that contains all of
 * it, so a candidate also collides when it shares at least OVERLAP_MIN_SHARED
 * keywords and those cover at least OVERLAP_MIN_CONTAINMENT of the smaller set.
 * Over the 2,645 published titles this adds one pair beyond Jaccard 0.35.
 */
export const OVERLAP_MIN_SHARED = 3;
export const OVERLAP_MIN_CONTAINMENT = 0.8;

function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/**
 * Score a candidate topic against a corpus of existing items
 * (open PRs and/or published articles). Returns:
 *   - verdict: collision if max Jaccard ≥ threshold or the overlap test fires; clear otherwise
 *   - empty_candidate if the candidate produces zero content-bearing keywords
 *   - top-3 neighbors regardless of verdict (for diagnostics)
 */
export function scoreCandidate(
  candidate: Candidate,
  corpus: CorpusItem[],
  threshold: number,
): ScoreResult {
  const candidateSet = tokenize(candidate.title, candidate.tags ?? []);
  const candidate_keywords = [...candidateSet].sort();

  if (candidateSet.size === 0) {
    return {
      verdict: 'empty_candidate',
      max_jaccard: 0,
      threshold,
      neighbors: [],
      candidate_keywords,
    };
  }

  const scored: Neighbor[] = corpus.map(item => {
    const itemSet = tokenize(item.title, item.tags ?? []);
    const shared = sharedCount(candidateSet, itemSet);
    const smaller = Math.min(candidateSet.size, itemSet.size);
    return {
      type: item.type,
      ref: item.ref,
      title: item.title,
      jaccard: jaccard(candidateSet, itemSet),
      shared,
      containment: smaller === 0 ? 0 : shared / smaller,
    };
  });

  scored.sort((a, b) => b.jaccard - a.jaccard);
  const neighbors = scored.slice(0, TOP_N_NEIGHBORS);
  const top = scored[0];
  const max_jaccard = top?.jaccard ?? 0;

  const byJaccard = scored.find(n => n.jaccard >= threshold);
  const byOverlap = scored.find(
    n => n.shared >= OVERLAP_MIN_SHARED && n.containment >= OVERLAP_MIN_CONTAINMENT,
  );
  const hit = byJaccard ?? byOverlap;
  if (hit) {
    return {
      verdict: 'collision',
      max_jaccard,
      threshold,
      collision_with: hit,
      collision_reason: byJaccard ? 'jaccard' : 'overlap',
      neighbors,
      candidate_keywords,
    };
  }

  return {
    verdict: 'clear',
    max_jaccard,
    threshold,
    neighbors,
    candidate_keywords,
  };
}

const SLUG_MAX_KEYWORD_CHARS = 160;
const SLUG_HASH_LENGTH = 8;

/**
 * Deterministic short slug for atomic-claim branch names.
 *
 * Two candidates that tokenize to the same keyword set produce the SAME slug.
 * Format: `<keywords>-<sha8>` where:
 *  - keywords are the candidate's tokens in alphabetical order joined by `-`,
 *    cut at a token boundary once they reach SLUG_MAX_KEYWORD_CHARS (a git ref
 *    name is limited to 255 bytes). Tokens are `[a-z0-9]+`, so they never
 *    contain `-` and the list can be read back from the branch name;
 *  - sha8 is the first 8 hex chars of sha256(sorted-keywords-joined-by-comma),
 *    computed over ALL tokens, so truncation never makes two different
 *    keyword sets collide on the same branch.
 *
 * Carrying the keywords in the branch name is what lets `topic:check` compare a
 * new candidate with claims that have been won but have not yet become a PR
 * (the window in which two parallel writers can otherwise pick the same story).
 *
 * If the candidate produces zero keywords, returns an empty string.
 */
export function canonicalSlug(candidate: Candidate): string {
  const tokens = [...tokenize(candidate.title, candidate.tags ?? [])].sort();
  if (tokens.length === 0) return '';
  const kept: string[] = [];
  let length = 0;
  for (const token of tokens) {
    const added = token.length + (kept.length > 0 ? 1 : 0);
    if (length + added > SLUG_MAX_KEYWORD_CHARS) break;
    kept.push(token);
    length += added;
  }
  if (kept.length === 0) kept.push(tokens[0]!.slice(0, SLUG_MAX_KEYWORD_CHARS));
  const sha = crypto.createHash('sha256')
    .update(tokens.join(','))
    .digest('hex')
    .slice(0, SLUG_HASH_LENGTH);
  return `${kept.join('-')}-${sha}`;
}

/**
 * Read the keyword list back out of a claim branch name
 * (`claim/<keywords>-<sha8>` or `refs/heads/claim/...`).
 */
export function claimKeywordsFromRef(ref: string): string[] {
  const marker = 'claim/';
  const at = ref.indexOf(marker);
  const slug = at === -1 ? ref : ref.slice(at + marker.length);
  const parts = slug.split('-').filter(Boolean);
  if (parts.length > 0 && /^[0-9a-f]{8}$/.test(parts[parts.length - 1]!)) parts.pop();
  return parts;
}

/**
 * Turn the output of
 *   gh api --paginate repos/<repo>/git/matching-refs/heads/claim/ --jq '.[].ref'
 * (one ref per line) into corpus items, so a candidate is compared with the
 * topics other writers have claimed but not yet opened a PR for. `ownRef`
 * (this worktree's own won claim, `claim/<slug>`) is skipped so a writer that
 * re-runs the check after claiming does not collide with itself.
 */
export function parseClaimRefs(text: string, ownRef?: string): CorpusItem[] {
  const out: CorpusItem[] = [];
  for (const line of text.split('\n')) {
    const ref = line.trim();
    if (!ref.includes('claim/')) continue;
    const name = ref.slice(ref.indexOf('claim/'));
    if (ownRef && name === ownRef.replace(/^refs\/heads\//, '')) continue;
    const keywords = claimKeywordsFromRef(name);
    if (keywords.length === 0) continue;
    out.push({ type: 'claim', ref: name, title: keywords.join(' '), tags: [] });
  }
  return out;
}

/**
 * Persisted record of a won atomic claim.
 *
 * Written by `claim_topic.ts` when a claim is won and read by
 * `submission_pr.ts` when it opens the PR. The claim branch name is derived
 * from the candidate title at claim time; if the bot rewords the title before
 * submitting, the title-derived slug at PR time no longer matches the branch
 * that was actually created. Persisting the winning slug lets the PR script
 * delete the correct `claim/<slug>` branch regardless of title drift.
 */
export interface ClaimState {
  slug: string;
  ref: string;
  title: string;
  tags: string[];
  repo?: string;
  base_branch?: string;
}

/**
 * Filename for the per-worktree claim-state record. It lives inside the git
 * directory (resolved via {@link resolveGitDir}) so it is never committed and
 * is naturally isolated per worktree.
 */
export const CLAIM_STATE_FILENAME = 'topic-claim.json';

export function claimStatePath(gitDir: string): string {
  return path.join(gitDir, CLAIM_STATE_FILENAME);
}

/**
 * Resolve the absolute git directory for `cwd`. In a worktree this is the
 * worktree-specific git dir (e.g. `<main>/.git/worktrees/<name>`), so claim
 * state written by one agent never leaks into another worktree.
 */
export function resolveGitDir(cwd: string = process.cwd()): string {
  return execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd,
    encoding: 'utf-8',
  }).trim();
}

export function writeClaimState(gitDir: string, state: ClaimState): void {
  fs.writeFileSync(claimStatePath(gitDir), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

/**
 * Read the persisted claim state. Returns null when no file exists, the JSON is
 * malformed, or the record has no usable slug. Backfills `ref`/`tags` for
 * older records that predate those fields.
 */
export function readClaimState(gitDir: string): ClaimState | null {
  const p = claimStatePath(gitDir);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<ClaimState>;
    if (typeof parsed.slug !== 'string' || parsed.slug === '') return null;
    return {
      slug: parsed.slug,
      ref: typeof parsed.ref === 'string' ? parsed.ref : `claim/${parsed.slug}`,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      repo: typeof parsed.repo === 'string' ? parsed.repo : undefined,
      base_branch: typeof parsed.base_branch === 'string' ? parsed.base_branch : undefined,
    };
  } catch {
    return null;
  }
}

export function clearClaimState(gitDir: string): void {
  const p = claimStatePath(gitDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * Compute the set of `claim/<slug>` branch slugs to delete when opening a
 * submission PR. Always includes the slug derived from the final submission
 * title+tags; additionally includes the persisted winning slug when present
 * and different (the title-drift case). Empty slugs are skipped; the result is
 * deduplicated and order-stable (submission slug first).
 */
export function claimSlugsToDelete(submission: Candidate, state: ClaimState | null): string[] {
  const slugs: string[] = [];
  const fromSubmission = canonicalSlug(submission);
  if (fromSubmission) slugs.push(fromSubmission);
  if (state?.slug && !slugs.includes(state.slug)) slugs.push(state.slug);
  return slugs;
}

interface ArticleFrontmatter {
  title: string;
  date: string;
  tags?: string[];
}

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Supports: `key: "value"`, `key: value`, `key: ["a", "b"]`.
 * Returns null if no frontmatter or required fields missing.
 */
function parseFrontmatter(content: string): ArticleFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match || match[1] === undefined) return null;
  const body: string = match[1];
  const out: Record<string, unknown> = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2];
    if (key === undefined || raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      // Array literal: ["a", "b"]
      try {
        out[key] = JSON.parse(trimmed);
      } catch {
        // skip malformed array
      }
    } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      out[key] = trimmed.slice(1, -1);
    } else {
      out[key] = trimmed;
    }
  }
  if (typeof out.title !== 'string' || typeof out.date !== 'string') {
    return null;
  }
  return {
    title: out.title,
    date: out.date,
    tags: Array.isArray(out.tags) ? out.tags as string[] : [],
  };
}

/**
 * Walk `<articlesDir>/YYYY-MM/*.md` and return a CorpusItem per article whose
 * frontmatter `date` is within `lookbackDays` of `now`.
 *
 * Tolerates missing dirs and malformed frontmatter (logs to stderr, skips).
 */
export function walkArchive(articlesDir: string, now: Date, lookbackDays: number): CorpusItem[] {
  if (!fs.existsSync(articlesDir)) return [];
  const cutoff = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const monthFolders = fs.readdirSync(articlesDir).filter(name =>
    /^\d{4}-\d{2}$/.test(name) &&
    fs.statSync(path.join(articlesDir, name)).isDirectory()
  );

  const items: CorpusItem[] = [];
  for (const monthFolder of monthFolders) {
    const monthDir = path.join(articlesDir, monthFolder);
    const files = fs.readdirSync(monthDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(monthDir, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        console.error(`[topic-check] could not read ${filePath}: ${err}`);
        continue;
      }
      const fm = parseFrontmatter(content);
      if (!fm) {
        console.error(`[topic-check] malformed frontmatter, skipping: ${filePath}`);
        continue;
      }
      const articleDate = new Date(fm.date);
      if (Number.isNaN(articleDate.getTime())) continue;
      if (articleDate < cutoff) continue;
      const slug = file.replace(/\.md$/, '');
      items.push({
        type: 'published_article',
        ref: `${monthFolder}/${slug}`,
        title: fm.title,
        tags: fm.tags ?? [],
      });
    }
  }
  return items;
}

interface GhPrEntry {
  number: number;
  title: string;
  headRefName: string;
}

/**
 * Parse the JSON output of:
 *   gh pr list --state open --json number,title,headRefName --limit 200
 * (filtered to `submission/` branches here; no `--search`, which 401s under some tokens)
 *
 * Filters to PRs whose branch name starts with `submission/`. Strips the
 * "Submit: " prefix that submission_pr.ts adds, since it's not part of the
 * topic title.
 */
export function parseOpenPRs(json: string): CorpusItem[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) return [];
  const out: CorpusItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<GhPrEntry>;
    if (typeof e.number !== 'number') continue;
    if (typeof e.title !== 'string') continue;
    if (typeof e.headRefName !== 'string') continue;
    if (!e.headRefName.startsWith('submission/')) continue;
    const title = e.title.replace(/^Submit:\s*/, '');
    out.push({
      type: 'open_pr',
      ref: `PR #${e.number}`,
      title,
      tags: [],
    });
  }
  return out;
}
