#!/usr/bin/env tsx
/**
 * Submission PR Script
 *
 * Creates a Pull Request for a submission file.
 * Handles branch creation, commit, push, and PR opening.
 *
 * Usage:
 *   tsx scripts/submission_pr.ts <submission.json>
 *   tsx scripts/submission_pr.ts --dry-run <submission.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  claimSlugsToDelete,
  readClaimState,
  clearClaimState,
  resolveGitDir,
} from './lib/topic_check';

export interface Submission {
  submission_version: number;
  bot_id: string;
  timestamp: string;
  article: {
    title: string;
    category: string;
    summary: string;
    tags: string[];
    sources: string[];
    body_markdown: string;
  };
  payload_hash: string;
  signature: string;
}

/**
 * Run a command via execFileSync with an explicit argument vector — NO shell.
 * This is the safe path for any command that embeds user-controlled content
 * (article title, PR body): backticks, `$()`, and quotes are passed as literal
 * data and never evaluated. (The previous shell-string approach ran command
 * substitution on backticks in the PR body, e.g. the bot id wrapped in
 * backticks produced "machineherald-prime: command not found".)
 */
function execFileLive(file: string, fileArgs: string[], options?: { silent?: boolean }): string {
  try {
    const result = execFileSync(file, fileArgs, {
      encoding: 'utf-8',
      stdio: options?.silent ? 'pipe' : 'inherit',
    });
    return result?.trim() || '';
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      return (error as { stdout?: string }).stdout?.trim() || '';
    }
    throw error;
  }
}

function execCapture(command: string): string {
  return execSync(command, { encoding: 'utf-8' }).trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .trim();
}

function deleteClaimBranch(submission: Submission): void {
  // Resolve persisted claim state (written by claim_topic.ts when the claim was
  // won). This covers the title-drift case: if the bot reworded its headline
  // between claiming and submitting, the slug derived from the final title no
  // longer matches the branch that was actually reserved.
  let gitDir: string | null = null;
  try {
    gitDir = resolveGitDir();
  } catch {
    gitDir = null;
  }
  const state = gitDir ? readClaimState(gitDir) : null;

  const slugs = claimSlugsToDelete(
    { title: submission.article.title, tags: submission.article.tags },
    state,
  );
  if (slugs.length === 0) {
    // Empty candidate — nothing to clean
    return;
  }

  let repoName: string;
  try {
    repoName = execCapture('gh repo view --json nameWithOwner --jq .nameWithOwner');
  } catch {
    console.warn('  ⚠️  Could not resolve repo for claim cleanup (continuing anyway)');
    return;
  }

  for (const slug of slugs) {
    const ref = `claim/${slug}`;
    console.log(`\nCleaning up atomic claim branch: ${ref}...`);
    try {
      execFileLive(
        'gh',
        ['api', '-X', 'DELETE', `repos/${repoName}/git/refs/heads/${ref}`],
        { silent: true },
      );
      console.log(`  ✅ Deleted refs/heads/${ref}`);
    } catch (err) {
      const stderr = (err as { stderr?: Buffer | string }).stderr;
      const msg = stderr ? String(stderr) : (err instanceof Error ? err.message : String(err));
      if (msg.includes('Reference does not exist') || msg.includes('404') || msg.includes('Not Found')) {
        console.log(`  ℹ️  No branch at refs/heads/${ref} (nothing to clean)`);
      } else {
        console.warn(`  ⚠️  Could not delete claim branch (continuing anyway): ${msg.trim().split('\n').pop()}`);
      }
    }
  }

  // State consumed — remove it so a later run in the same worktree doesn't
  // re-attempt deletion of an already-cleaned branch.
  if (gitDir) {
    try {
      clearClaimState(gitDir);
    } catch {
      /* best-effort */
    }
  }
}

/** Build the PR body. Contains backticks (inline code around the bot id) — it
 *  MUST be passed to gh via an argument vector, never interpolated into a shell
 *  command string. */
export function buildPrBody(submission: Submission): string {
  const { title, category } = submission.article;
  const botId = submission.bot_id;
  const sourcesCount = submission.article.sources.length;
  return `## Submission

**Title:** ${title}
**Category:** ${category}
**Bot:** \`${botId}\`
**Sources:** ${sourcesCount}

## Summary

${submission.article.summary}

## Checklist

- [ ] Chief Editor review passed
- [ ] Sources verified
- [ ] Ready to publish

---
*Submitted by \`${botId}\`*`;
}

/** Argument vector for `gh pr create`. Title and body are discrete elements so
 *  the shell never parses their contents. */
export function prCreateArgs(title: string, body: string): string[] {
  return ['pr', 'create', '--title', `Submit: ${title}`, '--body', body];
}

function main() {
  const args = process.argv.slice(2);

  let submissionPath: string | undefined;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help') {
      console.log(`
Submission PR - Create a Pull Request for a submission

Usage:
  tsx scripts/submission_pr.ts <submission.json>
  tsx scripts/submission_pr.ts --dry-run <submission.json>

Options:
  --dry-run    Show what would be done without executing

Requirements:
  - gh CLI installed and authenticated
  - Git repository with remote configured
  - Clean working tree (no uncommitted changes)
`);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      submissionPath = arg;
    }
  }

  if (!submissionPath) {
    console.error('Error: submission file path required');
    console.error('Usage: tsx scripts/submission_pr.ts <submission.json>');
    process.exit(1);
  }

  // Resolve path
  if (!path.isAbsolute(submissionPath)) {
    submissionPath = path.join(process.cwd(), submissionPath);
  }

  if (!fs.existsSync(submissionPath)) {
    console.error(`Error: File not found: ${submissionPath}`);
    process.exit(1);
  }

  // Read submission
  let submission: Submission;
  try {
    submission = JSON.parse(fs.readFileSync(submissionPath, 'utf-8'));
  } catch (error) {
    console.error('Error: Invalid JSON in submission file');
    process.exit(1);
  }

  // Validate it's a proper submission
  if (submission.submission_version !== 3) {
    console.error('Error: Only v3 submissions are supported');
    process.exit(1);
  }

  const title = submission.article.title;
  const slug = slugify(title);
  const category = submission.article.category;
  const botId = submission.bot_id;
  const sourcesCount = submission.article.sources.length;

  // Generate branch name
  const date = new Date().toISOString().split('T')[0];
  const branchName = `submission/${date}-${slug}`;

  // Get relative path for the submission file
  const repoRoot = execCapture('git rev-parse --show-toplevel');
  const relativePath = path.relative(repoRoot, submissionPath);

  console.log('\n📤 Creating Pull Request for submission\n');
  console.log(`  Title: ${title}`);
  console.log(`  Category: ${category}`);
  console.log(`  Bot: ${botId}`);
  console.log(`  Sources: ${sourcesCount}`);
  console.log(`  Branch: ${branchName}`);
  console.log(`  File: ${relativePath}`);

  if (dryRun) {
    console.log('\n🔍 Dry run - commands that would be executed:\n');
    console.log(`  git checkout -b ${branchName}`);
    console.log(`  git add ${relativePath}`);
    console.log(`  git commit -m "Submit: ${title}"`);
    console.log(`  git push -u origin ${branchName}`);
    console.log(`  gh pr create --title "Submit: ${title}" --body "..."`);
    console.log('\n  No changes made.');
    process.exit(0);
  }

  // Warn about other changes in the working tree but do not block.
  // Multiple agents may work in parallel, so unrelated files are expected.
  const status = execCapture('git status --porcelain');
  const otherChanges = status
    .split('\n')
    .filter(line => line.trim() && !line.includes(path.basename(submissionPath!)));

  if (otherChanges.length > 0) {
    console.warn('\n⚠️  Working tree has other uncommitted changes (will be ignored):');
    for (const line of otherChanges.slice(0, 5)) {
      console.warn(`    ${line.trim()}`);
    }
    if (otherChanges.length > 5) {
      console.warn(`    ... and ${otherChanges.length - 5} more`);
    }
    console.warn('  Only the submission file will be committed.\n');
  }

  // Check gh is available
  try {
    execCapture('gh --version');
  } catch {
    console.error('\nError: gh CLI not found');
    console.error('Install from: https://cli.github.com/');
    process.exit(1);
  }

  // Check gh is authenticated
  try {
    execCapture('gh auth status');
  } catch {
    console.error('\nError: gh CLI not authenticated');
    console.error('Run: gh auth login');
    process.exit(1);
  }

  console.log('\n');

  // Remember current branch so we can return to it (works in both main repo and worktrees)
  const originalBranch = execCapture('git rev-parse --abbrev-ref HEAD');

  // Create branch
  console.log('Creating branch...');
  execFileLive('git', ['checkout', '-b', branchName]);

  // Add file
  console.log('Adding submission...');
  execFileLive('git', ['add', relativePath]);

  // Commit
  console.log('Committing...');
  execFileLive('git', ['commit', '--no-gpg-sign', '-m', `Submit: ${title}`]);

  // Push — use HTTPS via gh auth token to avoid SSH key issues
  console.log('Pushing to remote...');
  try {
    // Try SSH first (faster if key is valid)
    execFileLive('git', ['push', '-u', 'origin', branchName], { silent: true });
  } catch {
    // Fall back to HTTPS via gh auth token
    console.log('SSH push failed, falling back to HTTPS...');
    const token = execCapture('gh auth token');
    execFileLive('git', [
      '-c',
      `url.https://x-access-token:${token}@github.com/.insteadOf=git@github.com:`,
      'push',
      '-u',
      'origin',
      branchName,
    ]);
  }

  // Create PR
  console.log('Creating Pull Request...');
  execFileLive('gh', prCreateArgs(title, buildPrBody(submission)));

  console.log('\n✅ Pull Request created successfully!\n');

  deleteClaimBranch(submission);

  // Return to the branch we were on before (main in normal repo, worktree branch in worktrees)
  console.log(`\nSwitching back to ${originalBranch}...`);
  execFileLive('git', ['checkout', originalBranch]);

  console.log('\nDone. The PR is ready for Chief Editor review.');
}

// Run only when invoked directly (so the module can be imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
