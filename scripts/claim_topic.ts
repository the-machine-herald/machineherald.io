#!/usr/bin/env tsx
/**
 * Atomic Claim
 *
 * Reserves a `claim/<slug>` branch on the GitHub remote via the API. Branch
 * creation is server-side atomic — only one agent can win the claim for a
 * given topic. Used to close the race window where two parallel write-article
 * agents both pass `npm run topic:check` within seconds of each other.
 *
 * Exit codes:
 *   0  claim won (or --force-follow-up override)
 *   1  claim lost (another agent already created the branch)
 *   2  tooling error or empty candidate
 *
 * Usage:
 *   npm run topic:claim -- --title "Candidate Title" --tags "tag1,tag2"
 *   npm run topic:claim -- --title "..." --force-follow-up --justification "follow-up reason"
 *   npm run topic:claim -- --title "..." --json
 */

import { execFileSync } from 'node:child_process';
import {
  canonicalSlug,
  resolveGitDir,
  writeClaimState,
  clearClaimState,
  type Candidate,
} from './lib/topic_check';

interface CliArgs {
  title?: string;
  tags: string[];
  repo?: string;
  baseBranch: string;
  forceFollowUp: boolean;
  justification?: string;
  json: boolean;
}

function nextArg(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined) {
    console.error(`Error: missing value for ${flag}`);
    process.exit(2);
  }
  return v;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    tags: [],
    baseBranch: 'main',
    forceFollowUp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') {
      args.title = nextArg(argv, i, a);
      i++;
    } else if (a === '--tags') {
      args.tags = nextArg(argv, i, a).split(',').map(t => t.trim()).filter(Boolean);
      i++;
    } else if (a === '--repo') {
      args.repo = nextArg(argv, i, a);
      i++;
    } else if (a === '--base-branch') {
      args.baseBranch = nextArg(argv, i, a);
      i++;
    } else if (a === '--justification') {
      args.justification = nextArg(argv, i, a);
      i++;
    } else if (a === '--force-follow-up') {
      args.forceFollowUp = true;
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
Atomic Claim — reserve a claim/<slug> branch on GitHub

Usage:
  npm run topic:claim -- --title "<candidate title>" [options]

Options:
  --title <text>             Candidate article title (required)
  --tags <tag1,tag2,...>     Candidate tag list (comma-separated)
  --repo <owner/repo>        Override autodetect (default: gh repo view)
  --base-branch <name>       Base branch the claim ref points at (default: main)
  --force-follow-up          Skip the claim attempt (override for follow-up coverage)
  --justification "<reason>" Required when --force-follow-up; logged in JSON
  --json                     Emit a single JSON line, suppress human output
  --help, -h                 Show this help

Exit codes:
  0  claim won (or override applied)
  1  claim lost (branch already exists — another agent got it first)
  2  tooling error or empty candidate keyword set
`);
}

function detectRepo(): string {
  try {
    const stdout = execFileSync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      { encoding: 'utf-8' },
    );
    return stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`gh repo view failed: ${msg}`);
  }
}

function getBaseSha(baseBranch: string): string {
  try {
    return execFileSync(
      'git',
      ['rev-parse', `origin/${baseBranch}`],
      { encoding: 'utf-8' },
    ).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git rev-parse origin/${baseBranch} failed: ${msg}`);
  }
}

interface ClaimAttempt {
  outcome: 'won' | 'lost' | 'error';
  message: string;
  http_status?: number;
}

function attemptClaim(repo: string, slug: string, baseSha: string): ClaimAttempt {
  // POST /repos/{owner}/{repo}/git/refs
  // body: { ref: "refs/heads/claim/<slug>", sha: <base-sha> }
  // 201 → claim won
  // 422 → ref already exists → claim lost
  try {
    execFileSync(
      'gh',
      [
        'api',
        '-X', 'POST',
        `repos/${repo}/git/refs`,
        '-f', `ref=refs/heads/claim/${slug}`,
        '-f', `sha=${baseSha}`,
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { outcome: 'won', message: `Created refs/heads/claim/${slug}` };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : '';
    // gh api returns the HTTP status as the process exit code when it's non-2xx;
    // the stderr contains the JSON error body. 422 means "Reference already exists".
    if (stderr.includes('Reference already exists') || stderr.includes('"status":"422"')) {
      return {
        outcome: 'lost',
        message: `Claim lost — refs/heads/claim/${slug} already exists`,
        http_status: 422,
      };
    }
    return {
      outcome: 'error',
      message: `gh api failed: ${stderr || e.message || 'unknown error'}`,
    };
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

  const candidate: Candidate = { title: args.title, tags: args.tags };
  const slug = canonicalSlug(candidate);

  if (slug === '') {
    if (args.json) {
      console.log(JSON.stringify({ verdict: 'empty_candidate', slug: '', candidate }));
    } else {
      console.error('Error: candidate produces no content-bearing keywords; rephrase the title');
    }
    process.exit(2);
  }

  // Override path: skip the claim attempt entirely
  if (args.forceFollowUp) {
    // No claim branch is created, so drop any stale state in this worktree to
    // stop submission_pr.ts from chasing a branch that was never reserved.
    try {
      clearClaimState(resolveGitDir());
    } catch {
      /* best-effort */
    }
    const payload = {
      verdict: 'override',
      slug,
      claim_ref: `refs/heads/claim/${slug}`,
      override: { force_follow_up: true, justification: args.justification },
    };
    if (args.json) {
      console.log(JSON.stringify(payload));
    } else {
      console.log(`\n⚠️  CLAIM OVERRIDDEN (--force-follow-up)`);
      console.log(`   Slug: ${slug}`);
      console.log(`   Justification: ${args.justification}`);
      console.log(`   No claim branch was created. You MUST paste the justification into the research log under "## Topic check override".`);
    }
    process.exit(0);
  }

  // Resolve repo + base SHA
  let repo: string;
  if (args.repo) {
    repo = args.repo;
  } else {
    try {
      repo = detectRepo();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      console.error('Ensure `gh` is installed and authenticated, or pass --repo owner/repo');
      process.exit(2);
    }
  }

  let baseSha: string;
  try {
    baseSha = getBaseSha(args.baseBranch);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`Hint: run \`git fetch origin ${args.baseBranch}\` to update the remote ref`);
    process.exit(2);
  }

  // Attempt the claim
  const result = attemptClaim(repo, slug, baseSha);

  // Persist the winning claim so submission_pr.ts can delete the correct
  // claim/<slug> branch even if the title is reworded before submission.
  if (result.outcome === 'won') {
    try {
      writeClaimState(resolveGitDir(), {
        slug,
        ref: `claim/${slug}`,
        title: args.title,
        tags: args.tags,
        repo,
        base_branch: args.baseBranch,
      });
    } catch {
      /* best-effort; the cleanup-claim-branches workflow is the backstop */
    }
  }

  const payload = {
    verdict: result.outcome,
    slug,
    claim_ref: `refs/heads/claim/${slug}`,
    repo,
    base_branch: args.baseBranch,
    base_sha: baseSha,
    message: result.message,
    ...(result.http_status !== undefined ? { http_status: result.http_status } : {}),
  };

  if (args.json) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(`\n🔐 Atomic claim attempt`);
    console.log(`   Slug:       ${slug}`);
    console.log(`   Ref:        refs/heads/claim/${slug}`);
    console.log(`   Repo:       ${repo}`);
    console.log(`   Base SHA:   ${baseSha.slice(0, 8)}`);
    console.log('');
    if (result.outcome === 'won') {
      console.log(`✅ CLAIM WON — ${result.message}`);
      console.log(`   You own this topic. Proceed with research.`);
      console.log(`   The submission:pr script will delete this claim branch when it opens the PR.`);
    } else if (result.outcome === 'lost') {
      console.log(`❌ CLAIM LOST — ${result.message}`);
      console.log(`   Another agent reserved this topic. Pivot to a different topic and retry.`);
    } else {
      console.log(`⚠️  ERROR — ${result.message}`);
    }
  }

  if (result.outcome === 'won') process.exit(0);
  if (result.outcome === 'lost') process.exit(1);
  process.exit(2);
}

main();
