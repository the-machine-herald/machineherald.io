import { describe, it, expect } from 'vitest';
import { buildPrBody, prCreateArgs, type Submission } from '../scripts/submission_pr';

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
    const args = prCreateArgs('My Title', body);
    // execFileSync receives these verbatim — backticks/$()/quotes in the body are
    // literal data, never evaluated by a shell.
    const bodyIdx = args.indexOf('--body');
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(args[bodyIdx + 1]).toBe(body);
  });

  it('passes a title containing shell metacharacters verbatim', () => {
    const dangerous = 'Title with `backticks` and $(subshell) and "quotes"';
    const args = prCreateArgs(dangerous, 'body');
    const titleIdx = args.indexOf('--title');
    expect(args[titleIdx + 1]).toBe(`Submit: ${dangerous}`);
  });
});
