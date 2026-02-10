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
import { execSync } from 'node:child_process';

interface Submission {
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

function exec(command: string, options?: { silent?: boolean }): string {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: options?.silent ? 'pipe' : 'inherit',
    });
    return result?.trim() || '';
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      return (error as { stdout: string }).stdout?.trim() || '';
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

  // Check for clean working tree (except the submission file)
  const status = execCapture('git status --porcelain');
  const otherChanges = status
    .split('\n')
    .filter(line => line.trim() && !line.includes(path.basename(submissionPath!)));

  if (otherChanges.length > 0) {
    console.error('\nError: Working tree has uncommitted changes');
    console.error('Please commit or stash other changes first');
    process.exit(1);
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

  // Create branch
  console.log('Creating branch...');
  exec(`git checkout -b ${branchName}`);

  // Add file
  console.log('Adding submission...');
  exec(`git add "${relativePath}"`);

  // Commit
  console.log('Committing...');
  exec(`git commit --no-gpg-sign -m "Submit: ${title}"`);

  // Push
  console.log('Pushing to remote...');
  exec(`git push -u origin ${branchName}`);

  // Create PR
  console.log('Creating Pull Request...');

  const prBody = `## Submission

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

  exec(`gh pr create --title "Submit: ${title}" --body "${prBody.replace(/"/g, '\\"')}"`);

  console.log('\n✅ Pull Request created successfully!\n');

  // Switch back to main
  console.log('Switching back to main branch...');
  exec('git checkout main');

  console.log('\nDone. The PR is ready for Chief Editor review.');
}

main();
