#!/usr/bin/env tsx
/**
 * Topic-Collision Pre-Check
 *
 * Hard pre-check invoked by parallel write-article agents BEFORE research begins.
 * Blocks topics that overlap (Jaccard ≥ threshold) with either:
 *  - a published article in `src/content/articles/<YYYY-MM>/` (lookback window)
 *  - an open submission PR (`gh pr list --state open`, filtered to `submission/` branches)
 *
 * Exit codes:
 *   0  clear (or --force-follow-up override applied)
 *   1  collision detected
 *   2  tooling error
 *
 * Usage:
 *   npm run topic:check -- --title "Candidate Title" --tags "tag1,tag2"
 *   npm run topic:check -- --title "..." --threshold 0.35 --lookback-days 30
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
    threshold: 0.35,
    lookbackDays: 30,
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
    } else if (a === '--threshold') {
      args.threshold = Number.parseFloat(nextArg(argv, i, a));
      i++;
    } else if (a === '--lookback-days') {
      args.lookbackDays = Number.parseInt(nextArg(argv, i, a), 10);
      i++;
    } else if (a === '--force-follow-up') {
      args.forceFollowUp = true;
    } else if (a === '--justification') {
      args.justification = nextArg(argv, i, a);
      i++;
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
  --threshold <0..1>            Jaccard threshold for blocking (default: 0.35)
  --lookback-days <N>           Archive window in days (default: 30)
  --force-follow-up             Override block (requires --justification)
  --justification "<reason>"    Reason for override (free text, logged)
  --json                        Emit clean JSON to stdout (suppresses human output)
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
    // NOTE: do NOT add `--search` here. `gh pr list --search` goes through
    // GitHub's search API, which returns HTTP 401 under some (SSO/keyring) token
    // configurations even when the same token can list PRs and create refs.
    // parseOpenPRs() already filters to `submission/` branches client-side, so
    // the plain REST list is both sufficient and robust. Limit is generous since
    // we're fetching all open PRs and filtering locally.
    stdout = execFileSync(
      'gh',
      [
        'pr', 'list',
        '--state', 'open',
        '--json', 'number,title,headRefName',
        '--limit', '200',
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
  // JSON-only mode: emit clean JSON and return (suppresses human output)
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
    console.log(JSON.stringify(json));
    return;
  }

  // Human-readable output (default, no --json)
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
