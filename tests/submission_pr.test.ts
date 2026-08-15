import { describe, it, expect } from 'vitest';
import { buildPrBody, prCreateArgs, execFileLive, type Submission } from '../scripts/submission_pr';

function makeSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    submission_version: 3,
    bot_id: 'machineherald-prime',
    timestamp: '2026-06-03T11:15:43Z',
    article: {
      title: 'Some Article Title',
      category: 'News',
      summary: 'A short summary of the article.',
      tags: ['tag'],
      sources: ['https://example.com/a'],
      body_markdown: '## Overview\n\nBody.',
    },
    payload_hash: 'deadbeef',
    signature: 'sig',
    ...overrides,
  };
}

describe('buildPrBody', () => {
  it('wraps the bot id in backticks (the shell-injection hazard this guards against)', () => {
    const body = buildPrBody(makeSubmission());
    // The body legitimately contains backticks around the bot id. When this was
    // interpolated into a `/bin/sh -c` string, the shell ran command substitution
    // on `machineherald-prime`, emitting "machineherald-prime: command not found".
    expect(body).toContain('`machineherald-prime`');
  });
});

describe('prCreateArgs', () => {
  it('passes the body as a single discrete argv element (no shell parsing)', () => {
    const body = buildPrBody(makeSubmission());
    const args = prCreateArgs('My Title', body, 'submission/2026-06-03-some-article-title');
    // execFileSync receives these verbatim — backticks/$()/quotes in the body are
    // literal data, never evaluated by a shell.
    const bodyIdx = args.indexOf('--body');
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(args[bodyIdx + 1]).toBe(body);
  });

  it('passes a title containing shell metacharacters verbatim', () => {
    const dangerous = 'Title with `backticks` and $(subshell) and "quotes"';
    const args = prCreateArgs(dangerous, 'body', 'submission/2026-06-03-dangerous');
    const titleIdx = args.indexOf('--title');
    expect(args[titleIdx + 1]).toBe(`Submit: ${dangerous}`);
  });

  it('passes --head with the given branch and defaults --base to main', () => {
    // Regression test: gh's ambient branch-tracking detection fails inside
    // worktree agents, whose sparse-checkout restricts remote.origin.fetch to
    // main — no local remote-tracking ref exists for a freshly pushed branch,
    // so `gh pr create` errors with "you must first push the current branch
    // to a remote, or use the --head flag" even though the push succeeded.
    // Passing --head explicitly sidesteps that detection entirely.
    const args = prCreateArgs('Title', 'body', 'submission/2026-06-03-some-branch');
    const headIdx = args.indexOf('--head');
    expect(headIdx).toBeGreaterThanOrEqual(0);
    expect(args[headIdx + 1]).toBe('submission/2026-06-03-some-branch');
    const baseIdx = args.indexOf('--base');
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(args[baseIdx + 1]).toBe('main');
  });

  it('accepts an explicit --base override', () => {
    const args = prCreateArgs('Title', 'body', 'feature-branch', 'develop');
    const baseIdx = args.indexOf('--base');
    expect(args[baseIdx + 1]).toBe('develop');
  });
});

describe('execFileLive', () => {
  it('throws when the underlying command exits non-zero', () => {
    // Regression test: Node's execFileSync error objects always carry a
    // (possibly null) `stdout` property, so a bare `'stdout' in error` check
    // is true for essentially every failure. A prior version of this
    // function used that check to decide whether to swallow the error,
    // which meant `gh pr create` (and every other call) could fail while
    // the script still printed "✅ Pull Request created successfully!".
    expect(() => execFileLive('node', ['-e', 'process.exit(1)'], { silent: true })).toThrow();
  });

  it('returns trimmed stdout when the command succeeds', () => {
    const result = execFileLive('node', ['-e', "console.log('hello')"], { silent: true });
    expect(result).toBe('hello');
  });
});
