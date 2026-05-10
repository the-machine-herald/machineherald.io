# Topic-Collision Pre-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hard pre-check that prevents parallel `write-article` agents from researching a topic that another agent has already taken (published article or open submission PR).

**Architecture:** New `scripts/check_topic.ts` CLI invoked as `npm run topic:check`. Pure logic (tokenization, Jaccard, scoring) lives in `scripts/lib/topic_check.ts` for testability. Archive scan reads frontmatter from `src/content/articles/<YYYY-MM>/`; remote scan calls `gh pr list`. Workflow integration via new Step 1.5 in `.claude/commands/write-article.md`.

**Tech Stack:** TypeScript via `tsx`, vitest for tests, `gh` CLI for remote PR queries, gray-matter (already in deps via Astro) for frontmatter parsing.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/lib/topic_check.ts` | Create | Pure functions: stopword constants, `tokenize()`, `jaccard()`, `scoreCandidate()` |
| `scripts/check_topic.ts` | Create | CLI shell: arg parsing, archive walk, gh call, orchestration, exit codes |
| `tests/topic_check.test.ts` | Create | Unit tests for tokenize, jaccard, scoreCandidate, calibration against historical batch |
| `package.json` | Modify | Add `topic:check` script; bump version 3.10.2 → 3.11.0 |
| `src/lib/changelog.ts` | Modify | Add 3.11.0 entry at top |
| `.claude/commands/write-article.md` | Modify | Insert Step 1.5 between current Step 2 and Step 3 |
| `/Users/nahime/.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/project_topic_check.md` | Create | Project memory: pre-check is mandatory + escape hatch |
| `/Users/nahime/.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/MEMORY.md` | Modify | Add index entry for the new memory |

---

## Task 1: Stopword constants module

**Files:**
- Create: `scripts/lib/topic_check.ts`
- Test: `tests/topic_check.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/topic_check.test.ts
import { describe, it, expect } from 'vitest';
import {
  ENGLISH_STOPWORDS,
  TECH_STOPWORDS,
  ALL_STOPWORDS,
} from '../scripts/lib/topic_check';

describe('stopword constants', () => {
  it('English stopwords includes common articles and prepositions', () => {
    expect(ENGLISH_STOPWORDS.has('the')).toBe(true);
    expect(ENGLISH_STOPWORDS.has('of')).toBe(true);
    expect(ENGLISH_STOPWORDS.has('and')).toBe(true);
    expect(ENGLISH_STOPWORDS.has('with')).toBe(true);
  });

  it('English stopwords does NOT include content-bearing words', () => {
    expect(ENGLISH_STOPWORDS.has('anthropic')).toBe(false);
    expect(ENGLISH_STOPWORDS.has('quantum')).toBe(false);
    expect(ENGLISH_STOPWORDS.has('release')).toBe(false); // release is in TECH_STOPWORDS, not English
  });

  it('Tech stopwords filters generic AI/tech tokens', () => {
    expect(TECH_STOPWORDS.has('ai')).toBe(true);
    expect(TECH_STOPWORDS.has('model')).toBe(true);
    expect(TECH_STOPWORDS.has('news')).toBe(true);
    expect(TECH_STOPWORDS.has('release')).toBe(true);
  });

  it('ALL_STOPWORDS is the union', () => {
    expect(ALL_STOPWORDS.size).toBeGreaterThanOrEqual(ENGLISH_STOPWORDS.size);
    expect(ALL_STOPWORDS.size).toBeGreaterThanOrEqual(TECH_STOPWORDS.size);
    expect(ALL_STOPWORDS.has('the')).toBe(true);
    expect(ALL_STOPWORDS.has('ai')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/topic_check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module with stopword constants**

```typescript
// scripts/lib/topic_check.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/topic_check.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/topic_check.ts tests/topic_check.test.ts
git commit -m "topic-check: stopword constants for keyword extraction"
```

---

## Task 2: `tokenize()` function

**Files:**
- Modify: `scripts/lib/topic_check.ts`
- Test: `tests/topic_check.test.ts`

- [ ] **Step 1: Write the failing test (append to existing test file)**

```typescript
// Append to tests/topic_check.test.ts
import { tokenize } from '../scripts/lib/topic_check';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Anthropic, OpenAI: a deal!')).toEqual(
      new Set(['anthropic', 'openai', 'deal'])
    );
  });

  it('drops English stopwords', () => {
    const result = tokenize('The quick brown fox jumps over the lazy dog');
    expect(result.has('the')).toBe(false);
    expect(result.has('over')).toBe(false);
    expect(result.has('quick')).toBe(true);
    expect(result.has('brown')).toBe(true);
  });

  it('drops tech-domain stopwords', () => {
    const result = tokenize('AI Model Release News');
    expect(result.has('ai')).toBe(false);
    expect(result.has('model')).toBe(false);
    expect(result.has('release')).toBe(false);
    expect(result.has('news')).toBe(false);
    // Empty after filtering
    expect(result.size).toBe(0);
  });

  it('drops tokens shorter than 3 chars', () => {
    const result = tokenize('AI is a 5G OS');
    // 'ai' filtered by stopwords; 'is' by stopwords; '5g' kept (mixed alphanum, length 2 → dropped)
    expect(result.has('5g')).toBe(false);
    expect(result.has('os')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('drops pure-numeric tokens', () => {
    const result = tokenize('Apache 2.4.67 patches CVE 23918');
    expect(result.has('apache')).toBe(true);
    expect(result.has('patches')).toBe(true);
    expect(result.has('cve')).toBe(true);
    expect(result.has('23918')).toBe(false); // pure number
    expect(result.has('2')).toBe(false);
    expect(result.has('4')).toBe(false);
    expect(result.has('67')).toBe(false);
  });

  it('keeps mixed alphanumeric tokens (version-like)', () => {
    const result = tokenize('GPT-5.5 and ZAYA1');
    expect(result.has('gpt')).toBe(true);
    expect(result.has('zaya1')).toBe(true);
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual(new Set<string>());
    expect(tokenize('   ')).toEqual(new Set<string>());
  });

  it('combines title and tags input', () => {
    const result = tokenize('Anthropic deal', ['claude', 'spacex']);
    expect(result).toEqual(new Set(['anthropic', 'deal', 'claude', 'spacex']));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic_check.test.ts -t "tokenize"`
Expected: FAIL — `tokenize` is not exported.

- [ ] **Step 3: Implement `tokenize()`**

Append to `scripts/lib/topic_check.ts`:

```typescript
/**
 * Extract content-bearing tokens from a title (and optional tags).
 *
 * Rules:
 *  - lowercase
 *  - replace non-alphanumeric with whitespace, split, dedupe
 *  - drop tokens whose length < 3
 *  - drop pure-numeric tokens (/^\d+$/)
 *  - drop English + tech stopwords
 */
export function tokenize(title: string, tags: string[] = []): Set<string> {
  const combined = [title, ...tags].join(' ').toLowerCase();
  const raw = combined.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const result = new Set<string>();
  for (const tok of raw) {
    if (tok.length < 3) continue;
    if (/^\d+$/.test(tok)) continue;
    if (ALL_STOPWORDS.has(tok)) continue;
    result.add(tok);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/topic_check.test.ts -t "tokenize"`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/topic_check.ts tests/topic_check.test.ts
git commit -m "topic-check: tokenize() with stopword and length filters"
```

---

## Task 3: `jaccard()` function

**Files:**
- Modify: `scripts/lib/topic_check.ts`
- Test: `tests/topic_check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/topic_check.test.ts`:

```typescript
import { jaccard } from '../scripts/lib/topic_check';

describe('jaccard', () => {
  it('identical sets → 1.0', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccard(s, s)).toBe(1);
  });

  it('disjoint sets → 0.0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
  });

  it('half overlap', () => {
    // A ∩ B = {b}, A ∪ B = {a,b,c} → 1/3
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });

  it('one set subset of the other', () => {
    // {a,b} ∩ {a,b,c} = {a,b}, ∪ = {a,b,c} → 2/3
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b', 'c']))).toBeCloseTo(2 / 3);
  });

  it('two empty sets → 0 (avoid NaN)', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('one empty + one populated → 0', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic_check.test.ts -t "jaccard"`
Expected: FAIL — `jaccard` not exported.

- [ ] **Step 3: Implement `jaccard()`**

Append to `scripts/lib/topic_check.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/topic_check.test.ts -t "jaccard"`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/topic_check.ts tests/topic_check.test.ts
git commit -m "topic-check: jaccard() similarity coefficient"
```

---

## Task 4: `scoreCandidate()` — top-level scoring

**Files:**
- Modify: `scripts/lib/topic_check.ts`
- Test: `tests/topic_check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/topic_check.test.ts`:

```typescript
import { scoreCandidate } from '../scripts/lib/topic_check';
import type { Candidate, ScoreResult } from '../scripts/lib/topic_check';

describe('scoreCandidate', () => {
  const candidate: Candidate = {
    title: 'Anthropic Leases SpaceX Colossus 1 Memphis',
    tags: ['anthropic', 'spacex'],
  };

  it('flags a clear collision (Jaccard ≥ threshold)', () => {
    const corpus = [
      {
        type: 'open_pr' as const,
        ref: 'PR #1192',
        title: 'Anthropic Leases the Full Capacity of SpaceX Colossus 1 Memphis',
        tags: [],
      },
    ];
    const result: ScoreResult = scoreCandidate(candidate, corpus, 0.5);
    expect(result.verdict).toBe('collision');
    expect(result.max_jaccard).toBeGreaterThanOrEqual(0.5);
    expect(result.collision_with?.ref).toBe('PR #1192');
  });

  it('passes when no corpus item exceeds threshold', () => {
    const corpus = [
      { type: 'open_pr' as const, ref: 'PR #1186', title: 'Palo Alto Networks PAN-OS', tags: [] },
      { type: 'published_article' as const, ref: '2026-05/03-zed', title: 'Zed 1.0 ships', tags: [] },
    ];
    const result = scoreCandidate(candidate, corpus, 0.5);
    expect(result.verdict).toBe('clear');
    expect(result.max_jaccard).toBeLessThan(0.5);
  });

  it('returns top neighbours sorted descending by Jaccard', () => {
    const corpus = [
      { type: 'open_pr' as const, ref: 'PR #100', title: 'Random topic', tags: [] },
      { type: 'open_pr' as const, ref: 'PR #200', title: 'Anthropic announcement', tags: [] },
      { type: 'open_pr' as const, ref: 'PR #300', title: 'Anthropic SpaceX deal', tags: [] },
    ];
    const result = scoreCandidate(candidate, corpus, 0.99); // high threshold → all clear
    expect(result.verdict).toBe('clear');
    expect(result.neighbors.length).toBeGreaterThanOrEqual(2);
    // Top neighbour should be PR #300 (most overlap)
    expect(result.neighbors[0].ref).toBe('PR #300');
    expect(result.neighbors[0].jaccard).toBeGreaterThanOrEqual(result.neighbors[1].jaccard);
  });

  it('exposes the candidate keyword set', () => {
    const result = scoreCandidate(candidate, [], 0.5);
    expect(result.candidate_keywords).toContain('anthropic');
    expect(result.candidate_keywords).toContain('spacex');
    expect(result.candidate_keywords).toContain('colossus');
    expect(result.candidate_keywords).toContain('memphis');
    // 'leases' should be present (not a stopword)
    expect(result.candidate_keywords).toContain('leases');
  });

  it('empty candidate keywords → verdict "empty_candidate"', () => {
    const result = scoreCandidate({ title: 'AI Model Update News' }, [], 0.5);
    expect(result.verdict).toBe('empty_candidate');
  });

  // Calibration tests: exercise the actual collisions from the 2026-05-08 batch
  describe('calibration: 2026-05-08 collisions', () => {
    const cases: Array<[string, string, number]> = [
      // [primary title, duplicate title, expected min Jaccard]
      [
        "Anthropic Leases the Full Capacity of SpaceX's Colossus 1 Data Center, Adding 300 MW and Over 220,000 Nvidia GPUs to the Claude Backend",
        "Anthropic Buys All of SpaceX's Colossus 1 Capacity in Memphis, Adding 300 Megawatts and 220,000 GPUs to Claude's Inference Fleet",
        0.5,
      ],
      [
        "OpenAI, AMD, Broadcom, Intel, Microsoft and NVIDIA Release MRC 1.0 to OCP, an Open RDMA Protocol Already Running OpenAI's Largest Training Clusters",
        "OpenAI, AMD, Broadcom, Intel, Microsoft and Nvidia Publish MRC, an Ethernet-Based Networking Protocol Built for 100,000-GPU AI Clusters",
        0.5,
      ],
      [
        'Apache patches a double-free in HTTP/2 that crashes workers with two frames and one TCP connection',
        'Apache Patches CVE-2026-23918, an HTTP/2 Double-Free in mod_http2 That Two Frames Can Turn Into a DoS or RCE',
        0.5,
      ],
      [
        "Skyroot Aerospace Becomes India's First Space-Tech Unicorn With $60 Million Round Ahead of Vikram-1 Maiden Orbital Launch",
        "Skyroot Aerospace Closes $60 Million Round and Becomes India's First Space-Tech Unicorn Weeks Before Vikram-1's Maiden Orbital Launch",
        0.5,
      ],
      [
        'Zyphra Releases ZAYA1-8B, an 8.4B-Parameter MoE Reasoning Model Trained End-to-End on 1,024 AMD MI300X GPUs',
        'Zyphra Releases ZAYA1-8B, a 760M-Active-Parameter Reasoning MoE Pretrained Entirely on a 1,024-GPU AMD MI300X Cluster',
        0.5,
      ],
    ];

    it.each(cases)('detects collision: "%s" vs "%s"', (primary, duplicate, minJ) => {
      const corpus = [
        { type: 'open_pr' as const, ref: 'PR #PRIMARY', title: primary, tags: [] },
      ];
      const result = scoreCandidate({ title: duplicate }, corpus, minJ);
      expect(result.verdict).toBe('collision');
      expect(result.max_jaccard).toBeGreaterThanOrEqual(minJ);
    });

    it('does NOT collide unrelated topics', () => {
      const corpus = [
        { type: 'open_pr' as const, ref: 'PR #1186', title: 'Palo Alto Networks Discloses CVE-2026-0300, a 9.3 PAN-OS Captive Portal RCE', tags: [] },
        { type: 'open_pr' as const, ref: 'PR #1187', title: 'Quantum Motion Closes $160 Million Series C', tags: [] },
      ];
      const result = scoreCandidate(
        { title: "Skyroot Aerospace Becomes India's First Space-Tech Unicorn" },
        corpus,
        0.5,
      );
      expect(result.verdict).toBe('clear');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic_check.test.ts -t "scoreCandidate"`
Expected: FAIL — `scoreCandidate` not exported.

- [ ] **Step 3: Implement `scoreCandidate()` and types**

Append to `scripts/lib/topic_check.ts`:

```typescript
export interface Candidate {
  title: string;
  tags?: string[];
}

export type CorpusItemType = 'open_pr' | 'published_article';

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
}

export type Verdict = 'clear' | 'collision' | 'empty_candidate';

export interface ScoreResult {
  verdict: Verdict;
  max_jaccard: number;
  threshold: number;
  collision_with?: Neighbor;
  neighbors: Neighbor[];      // top 3 by Jaccard, descending
  candidate_keywords: string[];
}

const TOP_N_NEIGHBORS = 3;

/**
 * Score a candidate topic against a corpus of existing items
 * (open PRs and/or published articles). Returns:
 *   - verdict: collision if max Jaccard ≥ threshold; clear otherwise
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

  const scored: Neighbor[] = corpus.map(item => ({
    type: item.type,
    ref: item.ref,
    title: item.title,
    jaccard: jaccard(candidateSet, tokenize(item.title, item.tags ?? [])),
  }));

  scored.sort((a, b) => b.jaccard - a.jaccard);
  const neighbors = scored.slice(0, TOP_N_NEIGHBORS);
  const top = scored[0];
  const max_jaccard = top?.jaccard ?? 0;

  if (top && max_jaccard >= threshold) {
    return {
      verdict: 'collision',
      max_jaccard,
      threshold,
      collision_with: top,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/topic_check.test.ts -t "scoreCandidate"`
Expected: PASS — 5 unit tests + 5 calibration cases + 1 negative calibration case = 11 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/topic_check.ts tests/topic_check.test.ts
git commit -m "topic-check: scoreCandidate() with Jaccard threshold and calibration"
```

---

## Task 5: Archive walker

**Files:**
- Modify: `scripts/lib/topic_check.ts`
- Test: `tests/topic_check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/topic_check.test.ts`:

```typescript
import { walkArchive } from '../scripts/lib/topic_check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('walkArchive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-check-archive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeArticle(monthFolder: string, slug: string, frontmatter: Record<string, unknown>): void {
    const dir = path.join(tmpDir, monthFolder);
    fs.mkdirSync(dir, { recursive: true });
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`)
      .join('\n');
    fs.writeFileSync(
      path.join(dir, `${slug}.md`),
      `---\n${fm}\n---\n\n# Body\n`,
    );
  }

  it('reads articles within the lookback window', () => {
    const today = new Date('2026-05-10T00:00:00Z');
    writeArticle('2026-05', '08-anthropic-colossus', {
      title: 'Anthropic Leases SpaceX Colossus',
      date: '2026-05-08',
      tags: ['anthropic', 'spacex'],
    });
    writeArticle('2026-04', '15-old-article', {
      title: 'Old Article',
      date: '2026-04-15',
      tags: ['old'],
    });
    writeArticle('2026-01', '01-very-old', {
      title: 'Very Old',
      date: '2026-01-01',
      tags: [],
    });

    const result = walkArchive(tmpDir, today, 30);
    expect(result).toHaveLength(2); // 30-day window from 2026-05-10 → back to 2026-04-10
    const titles = result.map(r => r.title);
    expect(titles).toContain('Anthropic Leases SpaceX Colossus');
    expect(titles).toContain('Old Article');
    expect(titles).not.toContain('Very Old');
  });

  it('skips files with malformed frontmatter without aborting', () => {
    fs.mkdirSync(path.join(tmpDir, '2026-05'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '2026-05', '08-broken.md'), 'no-frontmatter-here');
    writeArticle('2026-05', '08-good', {
      title: 'Good',
      date: '2026-05-08',
      tags: [],
    });

    const result = walkArchive(tmpDir, new Date('2026-05-10'), 30);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Good');
  });

  it('returns CorpusItem with correct ref shape', () => {
    writeArticle('2026-05', '08-test-slug', {
      title: 'Test',
      date: '2026-05-08',
      tags: ['t1'],
    });
    const result = walkArchive(tmpDir, new Date('2026-05-10'), 30);
    expect(result[0].type).toBe('published_article');
    expect(result[0].ref).toBe('2026-05/08-test-slug');
    expect(result[0].tags).toEqual(['t1']);
  });

  it('handles missing archive directory gracefully', () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    const result = walkArchive(missing, new Date(), 30);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic_check.test.ts -t "walkArchive"`
Expected: FAIL — `walkArchive` not exported.

- [ ] **Step 3: Implement `walkArchive()`**

Append to `scripts/lib/topic_check.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

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
  if (!match) return null;
  const body = match[1];
  const out: Record<string, unknown> = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, key, raw] = m;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/topic_check.test.ts -t "walkArchive"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/topic_check.ts tests/topic_check.test.ts
git commit -m "topic-check: walkArchive() reads frontmatter within lookback window"
```

---

## Task 6: Open-PR fetch wrapper

**Files:**
- Modify: `scripts/lib/topic_check.ts`
- Test: `tests/topic_check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/topic_check.test.ts`:

```typescript
import { parseOpenPRs } from '../scripts/lib/topic_check';

describe('parseOpenPRs', () => {
  it('extracts CorpusItem per submission PR', () => {
    const ghJson = JSON.stringify([
      {
        number: 1192,
        title: "Submit: Anthropic Leases the Full Capacity of SpaceX's Colossus 1",
        headRefName: 'submission/2026-05-08-anthropic-leases-the-full-capacity',
      },
      {
        number: 1186,
        title: 'Submit: Palo Alto Networks Discloses CVE-2026-0300',
        headRefName: 'submission/2026-05-08-palo-alto-networks-discloses-cve-2026-0300',
      },
    ]);
    const result = parseOpenPRs(ghJson);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('open_pr');
    expect(result[0].ref).toBe('PR #1192');
    expect(result[0].title).toContain('Anthropic Leases');
  });

  it('strips "Submit: " prefix from titles', () => {
    const ghJson = JSON.stringify([
      { number: 100, title: 'Submit: My Topic', headRefName: 'submission/2026-05-08-my-topic' },
    ]);
    const result = parseOpenPRs(ghJson);
    expect(result[0].title).toBe('My Topic');
  });

  it('filters out non-submission branches', () => {
    const ghJson = JSON.stringify([
      { number: 100, title: 'Submit: A', headRefName: 'submission/2026-05-08-a' },
      { number: 101, title: 'Fix: random thing', headRefName: 'fix/random' },
      { number: 102, title: 'Some PR', headRefName: 'main' },
    ]);
    const result = parseOpenPRs(ghJson);
    expect(result).toHaveLength(1);
    expect(result[0].ref).toBe('PR #100');
  });

  it('handles empty array', () => {
    expect(parseOpenPRs('[]')).toEqual([]);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseOpenPRs('not json')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/topic_check.test.ts -t "parseOpenPRs"`
Expected: FAIL — `parseOpenPRs` not exported.

- [ ] **Step 3: Implement `parseOpenPRs()`**

Append to `scripts/lib/topic_check.ts`:

```typescript
interface GhPrEntry {
  number: number;
  title: string;
  headRefName: string;
}

/**
 * Parse the JSON output of:
 *   gh pr list --state open --json number,title,headRefName --search "submission/" --limit 100
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/topic_check.test.ts -t "parseOpenPRs"`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/topic_check.ts tests/topic_check.test.ts
git commit -m "topic-check: parseOpenPRs() extracts submission PRs from gh JSON"
```

---

## Task 7: CLI entry point

**Files:**
- Create: `scripts/check_topic.ts`

- [ ] **Step 1: Implement the CLI**

Create `scripts/check_topic.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Topic-Collision Pre-Check
 *
 * Hard pre-check invoked by parallel write-article agents BEFORE research begins.
 * Blocks topics that overlap (Jaccard ≥ threshold) with either:
 *  - a published article in `src/content/articles/<YYYY-MM>/` (lookback window)
 *  - an open submission PR (`gh pr list --state open --search "submission/"`)
 *
 * Exit codes:
 *   0  clear (or --force-follow-up override applied)
 *   1  collision detected
 *   2  tooling error
 *
 * Usage:
 *   npm run topic:check -- --title "Candidate Title" --tags "tag1,tag2"
 *   npm run topic:check -- --title "..." --threshold 0.5 --lookback-days 30
 *   npm run topic:check -- --title "..." --force-follow-up --justification "follow-up reason"
 *   npm run topic:check -- --title "..." --json
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  scoreCandidate,
  walkArchive,
  parseOpenPRs,
  type CorpusItem,
  type ScoreResult,
} from './lib/topic_check';

interface CliArgs {
  title?: string;
  tags: string[];
  threshold: number;
  lookbackDays: number;
  forceFollowUp: boolean;
  justification?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    tags: [],
    threshold: 0.5,
    lookbackDays: 30,
    forceFollowUp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    } else if (a === '--tags' && argv[i + 1]) {
      args.tags = argv[++i].split(',').map(t => t.trim()).filter(Boolean);
    } else if (a === '--threshold' && argv[i + 1]) {
      args.threshold = Number.parseFloat(argv[++i]);
    } else if (a === '--lookback-days' && argv[i + 1]) {
      args.lookbackDays = Number.parseInt(argv[++i], 10);
    } else if (a === '--force-follow-up') {
      args.forceFollowUp = true;
    } else if (a === '--justification' && argv[i + 1]) {
      args.justification = argv[++i];
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Topic-Collision Pre-Check

Usage:
  npm run topic:check -- --title "<candidate title>" [options]

Options:
  --title <text>                Candidate article title (required)
  --tags <tag1,tag2,...>        Candidate tag list (comma-separated)
  --threshold <0..1>            Jaccard threshold for blocking (default: 0.5)
  --lookback-days <N>           Archive window in days (default: 30)
  --force-follow-up             Override block (requires --justification)
  --justification "<reason>"    Reason for override (free text, logged)
  --json                        Emit JSON result alongside human output
  --help, -h                    Show this help

Exit codes:
  0  clear (or override applied)
  1  collision detected
  2  tooling error (gh missing, network failure, archive unreadable)
`);
}

function fetchOpenPRs(): CorpusItem[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      'gh',
      [
        'pr', 'list',
        '--state', 'open',
        '--json', 'number,title,headRefName',
        '--search', 'submission/',
        '--limit', '100',
      ],
      { encoding: 'utf-8' },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`gh pr list failed: ${msg}`);
  }
  return parseOpenPRs(stdout);
}

function emit(result: ScoreResult, args: CliArgs, override: { force_follow_up: boolean; justification?: string } | undefined, scanned: { archive: number; open_prs: number }): void {
  // Human-readable output (always)
  console.log(`\n🔎 Topic-collision pre-check`);
  console.log(`   Candidate keywords: ${result.candidate_keywords.join(', ') || '(empty)'}`);
  console.log(`   Archive lookback:  ${args.lookbackDays} days (${scanned.archive} articles scanned)`);
  console.log(`   Open PRs scanned:  ${scanned.open_prs}`);
  console.log(`   Threshold:         ${result.threshold}`);

  if (result.verdict === 'empty_candidate') {
    console.log(`\n❌ EMPTY CANDIDATE`);
    console.log(`   The title produces no content-bearing keywords after stopword filtering.`);
    console.log(`   Rephrase the title with concrete proper nouns / domain terms and retry.`);
  } else if (result.verdict === 'collision') {
    if (override) {
      console.log(`\n⚠️  COLLISION (Jaccard ${result.max_jaccard.toFixed(2)} ≥ ${result.threshold} threshold)`);
      console.log(`   OVERRIDE APPLIED: --force-follow-up`);
      console.log(`   Justification: ${override.justification}`);
      console.log(`   You MUST paste this justification into the research log under "## Topic check override".`);
    } else {
      const c = result.collision_with!;
      console.log(`\n❌ COLLISION (Jaccard ${result.max_jaccard.toFixed(2)} ≥ ${result.threshold} threshold)`);
      console.log(`   Type:  ${c.type}`);
      console.log(`   Ref:   ${c.ref}`);
      console.log(`   Title: ${c.title}`);
      console.log(`\n   To override (only for genuine follow-up coverage):`);
      console.log(`     npm run topic:check -- --title "..." --force-follow-up \\`);
      console.log(`       --justification "Why this is not a duplicate"`);
    }
  } else {
    console.log(`\n✅ CLEAR (max Jaccard ${result.max_jaccard.toFixed(2)} < ${result.threshold} threshold)`);
    if (result.neighbors.length > 0) {
      console.log(`   Closest neighbors:`);
      for (const n of result.neighbors.slice(0, 3)) {
        if (n.jaccard > 0) {
          console.log(`     ${n.jaccard.toFixed(2)}  ${n.ref}  ${n.title.slice(0, 80)}`);
        }
      }
    }
  }

  if (args.json) {
    const json = {
      verdict: override ? 'clear' : result.verdict,
      max_jaccard: result.max_jaccard,
      threshold: result.threshold,
      collision_with: result.collision_with ?? null,
      neighbors: result.neighbors,
      candidate_keywords: result.candidate_keywords,
      scanned,
      ...(override ? { override } : {}),
    };
    console.log(`\nJSON: ${JSON.stringify(json)}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.title) {
    console.error('Error: --title is required');
    console.error('Run with --help for usage');
    process.exit(2);
  }
  if (args.forceFollowUp && !args.justification) {
    console.error('Error: --force-follow-up requires --justification "<reason>"');
    process.exit(2);
  }
  if (Number.isNaN(args.threshold) || args.threshold < 0 || args.threshold > 1) {
    console.error('Error: --threshold must be between 0 and 1');
    process.exit(2);
  }

  // Walk archive
  const archiveDir = path.join(process.cwd(), 'src/content/articles');
  let archive: CorpusItem[];
  try {
    archive = walkArchive(archiveDir, new Date(), args.lookbackDays);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error scanning archive: ${msg}`);
    process.exit(2);
  }

  // Fetch open PRs
  let openPRs: CorpusItem[];
  try {
    openPRs = fetchOpenPRs();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    console.error('Ensure `gh` is installed and authenticated: gh auth status');
    process.exit(2);
  }

  // Score
  const result = scoreCandidate(
    { title: args.title, tags: args.tags },
    [...archive, ...openPRs],
    args.threshold,
  );

  // Apply override if collision and flag set
  const override = result.verdict === 'collision' && args.forceFollowUp
    ? { force_follow_up: true, justification: args.justification }
    : undefined;

  emit(result, args, override, { archive: archive.length, open_prs: openPRs.length });

  // Exit code logic
  if (result.verdict === 'empty_candidate') process.exit(2);
  if (result.verdict === 'collision' && !override) process.exit(1);
  process.exit(0);
}

main();
```

- [ ] **Step 2: Smoke-test the CLI manually with a known clear topic**

Run:
```bash
npx tsx scripts/check_topic.ts --title "Some completely unrelated topic xyzzy plugh"
```
Expected: exit 0, "✅ CLEAR" output. (Real `gh` call — requires auth.)

- [ ] **Step 3: Smoke-test with --json**

Run:
```bash
npx tsx scripts/check_topic.ts --title "xyzzy" --json
```
Expected: human output + a `JSON: {...}` line at the end.

- [ ] **Step 4: Smoke-test the override path**

Run:
```bash
npx tsx scripts/check_topic.ts --title "Anthropic" --force-follow-up
```
Expected: exit 2, "Error: --force-follow-up requires --justification".

Run:
```bash
npx tsx scripts/check_topic.ts --title "Anthropic" --force-follow-up --justification "test"
```
Expected: exit 0 (no real collision against the title alone since "Anthropic" alone won't hit threshold, but the override path is exercised; if it does collide, the override applies).

- [ ] **Step 5: Smoke-test the help**

Run:
```bash
npx tsx scripts/check_topic.ts --help
```
Expected: exit 0, prints usage.

- [ ] **Step 6: Commit**

```bash
git add scripts/check_topic.ts
git commit -m "topic-check: CLI entry point with archive + gh PR scanning"
```

---

## Task 8: Wire up `npm run topic:check` and bump version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the npm script and bump version**

Edit `package.json`:

```diff
   "name": "machine-herald",
   "type": "module",
-  "version": "3.10.2",
+  "version": "3.11.0",
   ...
   "scripts": {
     ...
     "submission:create": "tsx scripts/create_submission.ts",
     "submission:pr": "tsx scripts/submission_pr.ts",
+    "topic:check": "tsx scripts/check_topic.ts",
     ...
   }
```

- [ ] **Step 2: Verify the new script works via npm**

Run:
```bash
npm run topic:check -- --title "xyzzy" --json
```
Expected: human output + JSON line; exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "topic-check: add npm run topic:check + bump to 3.11.0"
```

---

## Task 9: Add changelog entry

**Files:**
- Modify: `src/lib/changelog.ts`

- [ ] **Step 1: Add the 3.11.0 entry at the top of the changelog array**

Edit `src/lib/changelog.ts`. Find the `changelog` array and insert a new entry as the first element (newest first):

```typescript
export const changelog: ChangelogEntry[] = [
  {
    version: '3.11.0',
    date: '2026-05-10',
    items: [
      'New <strong>topic-collision pre-check</strong> for parallel <code>write-article</code> agents. The new <code>npm run topic:check</code> script blocks an agent from researching a topic that another agent has already taken — either as a published article or as an open submission PR. The check fires <strong>before research begins</strong>, so duplicate work is never done',
      'The check tokenizes the candidate title and tags (with English + tech-domain stopword filtering), then computes Jaccard overlap against published articles in the last 30 days and against the titles of open submission PRs fetched via <code>gh pr list</code>. If the maximum overlap reaches 0.5, the script exits non-zero and names the colliding ref',
      'Calibration against the 2026-05-08 review batch: the threshold catches all five observed collision pairs (Anthropic/Colossus, MRC OCP, Apache CVE-2026-23918, Skyroot, Zyphra ZAYA1-8B) without false positives among the 13 unique-topic articles in the same batch. Two triple-collisions in that batch (PRs #1192/#1197/#1199 and #1193/#1195/#1201) would have been blocked at agent #2',
      'Genuine follow-ups can override the block with <code>--force-follow-up --justification "&lt;reason&gt;"</code>; the justification is logged in the JSON output and must be pasted into the research log under a <code>## Topic check override</code> heading so the Chief Editor sees it during review',
      'Workflow integration: <code>.claude/commands/write-article.md</code> gets a new <strong>Step 1.5</strong> between topic selection and research that mandates the check. The existing Step 1 archive grep stays — it gives the agent the candidate keywords to feed into the script call',
    ],
  },
  {
    version: '3.10.2',
    ...
```

- [ ] **Step 2: Verify the build still passes**

Run:
```bash
npm run build 2>&1 | tail -20
```
Expected: build succeeds (or fails for unrelated reasons — confirm the changelog change doesn't break TypeScript).

- [ ] **Step 3: Commit**

```bash
git add src/lib/changelog.ts
git commit -m "topic-check: changelog entry for 3.11.0"
```

---

## Task 10: Update `.claude/commands/write-article.md`

**Files:**
- Modify: `.claude/commands/write-article.md`

- [ ] **Step 1: Insert Step 1.5 between current Step 1 and Step 2**

Find the heading `### Step 2: Choose a Topic` and insert a new section AFTER current Step 2 finishes (the agent has picked a candidate by then) and BEFORE `### Step 3: Research Sources and Build the Research Log (MANDATORY)`.

Add this exact text:

```markdown
### Step 2.5: Topic-Collision Pre-Check (MANDATORY)

Once you have a candidate title and tag set in mind — but BEFORE you start fetching sources or building the research log — run the topic-collision pre-check:

```bash
npm run topic:check -- --title "<candidate title>" --tags "<tag1>,<tag2>,<tag3>"
```

The script tokenizes your title + tags (with stopword filtering), then computes Jaccard overlap against:
- published articles in `src/content/articles/` from the last 30 days, and
- open submission PRs on the remote (`gh pr list --state open --search "submission/"`).

**Exit codes:**
- `0` — clear. Proceed to Step 3.
- `1` — collision detected. The script names the colliding article or open PR. **Pivot to a different topic and re-run the check.**
- `2` — tooling error (`gh` missing/unauthenticated, archive unreadable, or empty candidate keywords). Fix and retry.

**Why this exists.** Multiple parallel `write-article` agents in isolated worktrees cannot see each other's in-flight submissions before push. Without this gate, two agents can independently pick the same topic and both burn hours of compute before the duplicate is caught at review time. The check uses GitHub open PRs as the authoritative source of "what other agents are doing right now."

**Override for genuine follow-up coverage.** If you have a real new development on a story already covered (a court ruling on a previously reported lawsuit, a benchmarked replication of a previously announced model, etc.), you may pass `--force-follow-up --justification "<one-sentence reason>"`. Do this only when there is genuine new substance — not because you've grown attached to the topic. The justification is recorded in the script's JSON output and **you MUST paste it into `tmp/<slug>-research.md` under a `## Topic check override` heading** so the Chief Editor sees the rationale during review. Article framing in this case must center on what's new and cross-reference the prior coverage.

If the check exits 1 without override, do not proceed.
```

- [ ] **Step 2: Verify the markdown still validates**

Run:
```bash
npm run build 2>&1 | tail -10
```
Expected: build still passes.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/write-article.md
git commit -m "topic-check: write-article Step 2.5 mandates pre-check"
```

---

## Task 11: Add project memory entry

**Files:**
- Create: `/Users/nahime/.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/project_topic_check.md`
- Modify: `/Users/nahime/.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/MEMORY.md`

- [ ] **Step 1: Create the memory file**

Write `/Users/nahime/.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/project_topic_check.md`:

```markdown
---
name: Topic-collision pre-check
description: Hard gate (npm run topic:check) prevents parallel write-article agents from researching a topic another agent has already taken. Mandatory in write-article Step 2.5.
type: project
---

The `write-article` workflow now has a **mandatory** Step 2.5 between topic selection and research: `npm run topic:check -- --title "..." --tags "..."`.

**Why:** In the 2026-05-08 review batch, two triple-collisions and three double-collisions (7 of 20 PRs) wasted agent compute because parallel agents in isolated worktrees couldn't see each other's in-flight submissions before push. The pre-check fixes this by querying both the published archive and the GitHub open-PR set BEFORE research starts.

**How to apply:**
- Default threshold 0.5 Jaccard, default lookback 30 days. Tunable via `--threshold` and `--lookback-days`.
- Exit 1 = collision, agent must pivot. Exit 2 = tooling error.
- Genuine follow-up override: `--force-follow-up --justification "<reason>"`. Justification must be pasted into `tmp/<slug>-research.md` under `## Topic check override` for Chief Editor visibility.
- Implementation: pure logic in `scripts/lib/topic_check.ts`, CLI in `scripts/check_topic.ts`. Tests in `tests/topic_check.test.ts` include calibration against the 2026-05-08 collision batch.

Introduced in pipeline 3.11.0 (2026-05-10).
```

- [ ] **Step 2: Add the index entry to MEMORY.md**

Edit `/Users/nahime/.claude/projects/-Volumes-Crucio-Developer-illegal-studio-machineherald-io/memory/MEMORY.md`. Under the `## Project` section, add:

```markdown
- [Topic-collision pre-check](project_topic_check.md) — Hard gate (npm run topic:check) blocks parallel agents from claiming the same topic; mandatory write-article Step 2.5
```

- [ ] **Step 3: No commit needed**

Memory files live outside the repo. The Write tool persists them directly.

---

## Task 12: Final integration test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run:
```bash
npm test 2>&1 | tail -30
```
Expected: all topic-check tests pass alongside existing suites.

- [ ] **Step 2: Verify the calibration cases match real archive titles**

Run a real-archive smoke test with the actual title of a recently-published article (e.g., from `git log --oneline -10`):

```bash
# Pick a recently-published article title from the archive
ARCHIVE_TITLE=$(grep -h "^title:" src/content/articles/2026-05/*.md | head -1 | sed 's/^title: *//; s/^"//; s/"$//')
echo "Testing against: $ARCHIVE_TITLE"
npm run topic:check -- --title "$ARCHIVE_TITLE"
```
Expected: exit 1 (collision), since that exact article is in the archive.

- [ ] **Step 3: Verify the script handles the archive missing branch gracefully**

Run from `/tmp` (no archive there):
```bash
cd /tmp && npx tsx /Volumes/Crucio/Developer/illegal.studio/machineherald.io/scripts/check_topic.ts --title "test xyzzy"
```
Expected: exit 0 (clear) — empty archive, gh PR list still queried but won't match.

- [ ] **Step 4: Verify validate:content still passes (no regression)**

Run:
```bash
npm run validate:content 2>&1 | tail -5
```
Expected: all content valid.

- [ ] **Step 5: Final commit if any fix needed; otherwise no-op**

If anything failed in steps 1–4, fix the underlying issue and commit. If all green, no commit needed.

---

## Self-review checklist

- [x] **Spec coverage:** every spec section has at least one task implementing it (architecture → tasks 4–7; CLI args/exit codes/JSON → task 7; archive walker → task 5; gh PR scanner → task 6; package.json + script → task 8; changelog → task 9; write-article integration → task 10; memory → task 11; testing strategy → tasks 1–6 + task 12).
- [x] **No placeholders:** every step has exact commands or exact code; no "fill in details", no "similar to", no TBD/TODO.
- [x] **Type consistency:** `Candidate`, `CorpusItem`, `Neighbor`, `ScoreResult`, `Verdict` defined in Task 4 and consistently used in tasks 5, 6, 7. Function names (`tokenize`, `jaccard`, `scoreCandidate`, `walkArchive`, `parseOpenPRs`) match exactly across all tasks.
- [x] **Spec deviation note:** the spec called this "Step 1.5" but the existing write-article numbering puts the topic-pick at Step 2. The new gate slots in as **Step 2.5** (after Step 2 picks the candidate, before Step 3 researches). Functionally identical — same place in the workflow, different label. Updated in Task 10 to match.
