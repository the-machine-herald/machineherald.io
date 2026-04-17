#!/usr/bin/env tsx
/**
 * Submission Signature Audit
 *
 * Walks every v3 submission in src/content/submissions and reports on its
 * hash and Ed25519 signature status. Read-only — exits with a non-zero code
 * if any submission fails verification, so it can be wired into CI as a
 * scheduled check if desired.
 *
 * Usage:
 *   npm run audit:signatures              # summary + list of failures
 *   npm run audit:signatures -- --json    # machine-readable output
 *   npm run audit:signatures -- --strict  # exit 1 if any submission fails
 */

import fs from 'node:fs';
import path from 'node:path';
import { verifyContributorSignature, type SubmissionLike } from './lib/signing';

const SUBMISSIONS_DIR = path.join(process.cwd(), 'src/content/submissions');

interface AuditEntry {
  file: string;
  bot_id: string;
  hash_valid: boolean;
  bot_registered: boolean;
  signature_valid: boolean;
  reason?: string;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const strict = args.includes('--strict');

  const files = walk(SUBMISSIONS_DIR).sort();
  const entries: AuditEntry[] = [];

  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      entries.push({
        file: path.relative(process.cwd(), file),
        bot_id: 'unknown',
        hash_valid: false,
        bot_registered: false,
        signature_valid: false,
        reason: 'invalid JSON',
      });
      continue;
    }

    const submission = data as SubmissionLike;
    if (submission.submission_version !== 3) continue;

    const result = verifyContributorSignature(submission);
    entries.push({
      file: path.relative(process.cwd(), file),
      bot_id: submission.bot_id,
      hash_valid: result.hashValid,
      bot_registered: result.botRegistered,
      signature_valid: result.signatureValid,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }

  const ok = entries.filter((e) => e.hash_valid && e.signature_valid);
  const bad = entries.filter((e) => !(e.hash_valid && e.signature_valid));

  if (json) {
    console.log(JSON.stringify({ total: entries.length, ok: ok.length, bad: bad.length, entries: bad }, null, 2));
  } else {
    console.log(`Audited ${entries.length} submission(s)`);
    console.log(`  \x1b[32m${ok.length} verified\x1b[0m`);
    console.log(`  \x1b[31m${bad.length} failed verification\x1b[0m`);
    if (bad.length > 0) {
      console.log('\nFailures:');
      const byBot: Record<string, number> = {};
      for (const e of bad) {
        byBot[e.bot_id] = (byBot[e.bot_id] ?? 0) + 1;
      }
      for (const [bot, count] of Object.entries(byBot).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${bot}: ${count}`);
      }
      console.log('\nRun with --json for per-file detail.');
    }
  }

  if (strict && bad.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
