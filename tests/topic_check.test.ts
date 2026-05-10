import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ENGLISH_STOPWORDS,
  TECH_STOPWORDS,
  ALL_STOPWORDS,
  tokenize,
  jaccard,
  scoreCandidate,
  walkArchive,
  parseOpenPRs,
} from '../scripts/lib/topic_check';
import type { Candidate, ScoreResult } from '../scripts/lib/topic_check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
    expect(result.size).toBe(0);
  });

  it('drops tokens shorter than 3 chars', () => {
    const result = tokenize('AI is a 5G OS');
    expect(result.has('5g')).toBe(false);
    expect(result.has('os')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('drops pure-numeric tokens', () => {
    const result = tokenize('Apache 2.4.67 patches CVE 23918');
    expect(result.has('apache')).toBe(true);
    expect(result.has('patches')).toBe(true);
    expect(result.has('cve')).toBe(true);
    expect(result.has('23918')).toBe(false);
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
    const result: ScoreResult = scoreCandidate(candidate, corpus, 0.35);
    expect(result.verdict).toBe('collision');
    expect(result.max_jaccard).toBeGreaterThanOrEqual(0.35);
    expect(result.collision_with?.ref).toBe('PR #1192');
  });

  it('passes when no corpus item exceeds threshold', () => {
    const corpus = [
      { type: 'open_pr' as const, ref: 'PR #1186', title: 'Palo Alto Networks PAN-OS', tags: [] },
      { type: 'published_article' as const, ref: '2026-05/03-zed', title: 'Zed 1.0 ships', tags: [] },
    ];
    const result = scoreCandidate(candidate, corpus, 0.35);
    expect(result.verdict).toBe('clear');
    expect(result.max_jaccard).toBeLessThan(0.35);
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
    expect(result.neighbors[0].ref).toBe('PR #300');
    expect(result.neighbors[0].jaccard).toBeGreaterThanOrEqual(result.neighbors[1].jaccard);
  });

  it('exposes the candidate keyword set', () => {
    const result = scoreCandidate(candidate, [], 0.35);
    expect(result.candidate_keywords).toContain('anthropic');
    expect(result.candidate_keywords).toContain('spacex');
    expect(result.candidate_keywords).toContain('colossus');
    expect(result.candidate_keywords).toContain('memphis');
    expect(result.candidate_keywords).toContain('leases');
  });

  it('empty candidate keywords → verdict "empty_candidate"', () => {
    const result = scoreCandidate({ title: 'AI Model Update News' }, [], 0.35);
    expect(result.verdict).toBe('empty_candidate');
  });

  describe('calibration: 2026-05-08 collisions', () => {
    const cases: Array<[string, string, number]> = [
      [
        "Anthropic Leases the Full Capacity of SpaceX's Colossus 1 Data Center, Adding 300 MW and Over 220,000 Nvidia GPUs to the Claude Backend",
        "Anthropic Buys All of SpaceX's Colossus 1 Capacity in Memphis, Adding 300 Megawatts and 220,000 GPUs to Claude's Inference Fleet",
        0.35,
      ],
      [
        "OpenAI, AMD, Broadcom, Intel, Microsoft and NVIDIA Release MRC 1.0 to OCP, an Open RDMA Protocol Already Running OpenAI's Largest Training Clusters",
        "OpenAI, AMD, Broadcom, Intel, Microsoft and Nvidia Publish MRC, an Ethernet-Based Networking Protocol Built for 100,000-GPU AI Clusters",
        0.35,
      ],
      [
        'Apache patches a double-free in HTTP/2 that crashes workers with two frames and one TCP connection',
        'Apache Patches CVE-2026-23918, an HTTP/2 Double-Free in mod_http2 That Two Frames Can Turn Into a DoS or RCE',
        0.35,
      ],
      [
        "Skyroot Aerospace Becomes India's First Space-Tech Unicorn With $60 Million Round Ahead of Vikram-1 Maiden Orbital Launch",
        "Skyroot Aerospace Closes $60 Million Round and Becomes India's First Space-Tech Unicorn Weeks Before Vikram-1's Maiden Orbital Launch",
        0.35,
      ],
      [
        'Zyphra Releases ZAYA1-8B, an 8.4B-Parameter MoE Reasoning Model Trained End-to-End on 1,024 AMD MI300X GPUs',
        'Zyphra Releases ZAYA1-8B, a 760M-Active-Parameter Reasoning MoE Pretrained Entirely on a 1,024-GPU AMD MI300X Cluster',
        0.35,
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
        0.35,
      );
      expect(result.verdict).toBe('clear');
    });
  });
});

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
