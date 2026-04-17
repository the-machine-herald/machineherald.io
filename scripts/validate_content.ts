#!/usr/bin/env tsx
/**
 * Validates staged content files against their Zod schemas.
 * Used as a pre-commit hook to prevent invalid data from being committed.
 *
 * Usage:
 *   tsx scripts/validate_content.ts              # validate all staged content files
 *   tsx scripts/validate_content.ts --all        # validate all content files (not just staged)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { submissionSchema, provenanceSchema, reviewSchema, correctionsSchema, articleMetaSchema } from '../src/lib/schemas';
import { verifyContributorSignature, type SubmissionLike } from './lib/signing';

const CONTENT_DIR = path.join(process.cwd(), 'src/content');

interface ValidationResult {
  file: string;
  valid: boolean;
  errors?: string[];
}

const COLLECTION_SCHEMAS = {
  submissions: submissionSchema,
  provenance: provenanceSchema,
  reviews: reviewSchema,
  corrections: correctionsSchema,
  'article-meta': articleMetaSchema,
} as const;

function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getAllContentFiles(): string[] {
  const files: string[] = [];
  for (const collection of Object.keys(COLLECTION_SCHEMAS)) {
    const dir = path.join(CONTENT_DIR, collection);
    if (!fs.existsSync(dir)) continue;
    walkDir(dir, files);
  }
  return files.map((f) => path.relative(process.cwd(), f));
}

function walkDir(dir: string, results: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, results);
    else if (entry.name.endsWith('.json')) results.push(full);
  }
}

function validateFile(filePath: string, verifySignatures: boolean): ValidationResult | null {
  // Determine which collection this file belongs to
  const relPath = filePath.startsWith('src/') ? filePath : path.relative(process.cwd(), filePath);

  let collection: keyof typeof COLLECTION_SCHEMAS | null = null;
  for (const name of Object.keys(COLLECTION_SCHEMAS) as (keyof typeof COLLECTION_SCHEMAS)[]) {
    if (relPath.startsWith(`src/content/${name}/`)) {
      collection = name;
      break;
    }
  }

  if (!collection) return null;

  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) return null;

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  } catch (e) {
    return { file: relPath, valid: false, errors: [`Invalid JSON: ${e}`] };
  }

  const schema = COLLECTION_SCHEMAS[collection];
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`
    );
    return { file: relPath, valid: false, errors };
  }

  // For submissions, also cryptographically verify the contributor signature.
  // Schema validation alone only checks structure/format — it would happily
  // accept a submission with a random placeholder signature.
  //
  // Signature verification is enforced in the pre-commit hook (staged files)
  // and in CI (validate_submissions / chief_editor_review / generate_article),
  // so any new or modified submission is always verified before it can reach
  // main. It is intentionally skipped in `--all` audit mode to avoid failing
  // on pre-3.7.0 legacy content — run `scripts/audit_signatures.ts` instead
  // for a dedicated audit report.
  if (collection === 'submissions' && verifySignatures) {
    const verification = verifyContributorSignature(data as SubmissionLike);
    if (!verification.ok) {
      return {
        file: relPath,
        valid: false,
        errors: [`  signature: ${verification.reason}`],
      };
    }
  }

  return { file: relPath, valid: true };
}

function main() {
  const allMode = process.argv.includes('--all');
  const files = allMode ? getAllContentFiles() : getStagedFiles();

  // Staged-files mode (pre-commit) enforces signature verification — nothing
  // new reaches main without a valid signature. `--all` runs schema-only so
  // historical content that predates 3.7.0 doesn't block routine audits.
  const verifySignatures = !allMode;

  const results: ValidationResult[] = [];
  for (const file of files) {
    const result = validateFile(file, verifySignatures);
    if (result) results.push(result);
  }

  if (results.length === 0) {
    if (allMode) console.log('No content files found.');
    process.exit(0);
  }

  let hasErrors = false;
  for (const r of results) {
    if (r.valid) {
      console.log(`\x1b[32m✓\x1b[0m ${r.file}`);
    } else {
      hasErrors = true;
      console.log(`\x1b[31m✗\x1b[0m ${r.file}`);
      for (const err of r.errors || []) {
        console.log(`  \x1b[31m${err}\x1b[0m`);
      }
    }
  }

  if (hasErrors) {
    console.log('\n\x1b[31mSchema validation failed. Fix errors before committing.\x1b[0m');
    process.exit(1);
  }

  console.log(`\n\x1b[32mAll ${results.length} file(s) valid.\x1b[0m`);
  process.exit(0);
}

main();
