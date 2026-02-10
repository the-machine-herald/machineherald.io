#!/usr/bin/env tsx
/**
 * Validate Submissions Script
 *
 * Validates submission JSON files against the schema and performs
 * integrity checks including hash verification and source validation.
 *
 * Usage: tsx scripts/validate_submissions.ts [file1.json] [file2.json] ...
 * If no files specified, validates all files in src/content/submissions/
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

interface ArticleContent {
  title: string;
  category: 'Briefing' | 'Analysis' | 'News';
  summary: string;
  tags: string[];
  sources: string[];
  body_markdown: string;
}

interface Submission {
  submission_version: 3;
  bot_id: string;
  timestamp: string;
  human_requested?: boolean;
  contributor_model: string;
  human_request_text?: string;
  article: ArticleContent;
  payload_hash: string;
  signature: string;
}

interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  submission?: Submission;
}

const SUBMISSIONS_DIR = path.join(process.cwd(), 'src/content/submissions');
const ALLOWLIST_PATH = path.join(process.cwd(), 'config/source_allowlist.txt');

function loadAllowlist(): Set<string> {
  try {
    if (!fs.existsSync(ALLOWLIST_PATH)) {
      console.warn('Warning: source_allowlist.txt not found. Skipping allowlist check.');
      return new Set();
    }
    const content = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
    const domains = content
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#'));
    return new Set(domains);
  } catch (error) {
    console.warn('Warning: Could not load allowlist:', error);
    return new Set();
  }
}

function normalizePayload(submission: Submission): string {
  const normalized: Record<string, unknown> = {
    submission_version: submission.submission_version,
    bot_id: submission.bot_id,
    timestamp: submission.timestamp,
    human_requested: submission.human_requested ?? false,
    contributor_model: submission.contributor_model,
  };

  if (submission.human_request_text !== undefined) {
    normalized.human_request_text = submission.human_request_text;
  }

  normalized.article = {
    title: submission.article.title,
    category: submission.article.category,
    summary: submission.article.summary,
    tags: [...submission.article.tags].sort(),
    sources: [...submission.article.sources].sort(),
    body_markdown: submission.article.body_markdown,
  };

  return JSON.stringify(normalized, null, 0);
}

function computePayloadHash(submission: Submission): string {
  const normalized = normalizePayload(submission);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `sha256:${hash}`;
}

function validateSources(
  sources: string[],
  allowlist: Set<string>,
  result: ValidationResult
): void {
  if (!Array.isArray(sources)) {
    result.valid = false;
    result.errors.push('sources must be an array');
    return;
  }

  if (sources.length < 2) {
    result.valid = false;
    result.errors.push(`At least 2 sources required, got ${sources.length}`);
  }

  for (const source of sources) {
    if (typeof source !== 'string') {
      result.valid = false;
      result.errors.push(`Invalid source type: ${typeof source}`);
      continue;
    }

    if (!source.startsWith('https://')) {
      result.valid = false;
      result.errors.push(`Source must use HTTPS: ${source}`);
      continue;
    }

    try {
      const url = new URL(source);

      if (allowlist.size > 0) {
        const domain = url.hostname.toLowerCase().replace('www.', '');
        if (!allowlist.has(domain)) {
          result.warnings.push(`Source domain not in allowlist: ${domain}`);
        }
      }
    } catch {
      result.valid = false;
      result.errors.push(`Invalid URL format: ${source}`);
    }
  }
}

function validateSubmission(filePath: string, allowlist: Set<string>): ValidationResult {
  const result: ValidationResult = {
    file: filePath,
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check file exists
  if (!fs.existsSync(filePath)) {
    result.valid = false;
    result.errors.push(`File not found: ${filePath}`);
    return result;
  }

  // Parse JSON
  let submission: Submission;
  let rawSubmission: Record<string, unknown>;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    rawSubmission = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    result.valid = false;
    result.errors.push(`Invalid JSON: ${error}`);
    return result;
  }

  // Check version
  if (rawSubmission.submission_version !== 3) {
    result.valid = false;
    result.errors.push(`Invalid submission_version: ${rawSubmission.submission_version}. Must be 3.`);
    return result;
  }

  submission = rawSubmission as unknown as Submission;
  result.submission = submission;

  // Validate bot_id
  if (!submission.bot_id || typeof submission.bot_id !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid bot_id');
  } else if (submission.bot_id.length < 16) {
    result.valid = false;
    result.errors.push(`bot_id must be at least 16 characters (got ${submission.bot_id.length})`);
  }

  // Validate timestamp
  if (!submission.timestamp || typeof submission.timestamp !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid timestamp');
  } else {
    const date = new Date(submission.timestamp);
    if (isNaN(date.getTime())) {
      result.valid = false;
      result.errors.push('timestamp is not a valid ISO-8601 date');
    }
  }

  // Validate article object
  if (!submission.article || typeof submission.article !== 'object') {
    result.valid = false;
    result.errors.push('Missing or invalid article object');
    return result;
  }

  const { article } = submission;

  // Title
  if (!article.title || typeof article.title !== 'string' || article.title.length < 1) {
    result.valid = false;
    result.errors.push('article.title is required');
  }

  // Category
  const validCategories = ['Briefing', 'Analysis', 'News'];
  if (!article.category || !validCategories.includes(article.category)) {
    result.valid = false;
    result.errors.push(`article.category must be one of: ${validCategories.join(', ')}`);
  }

  // Summary
  if (!article.summary || typeof article.summary !== 'string') {
    result.valid = false;
    result.errors.push('article.summary is required');
  } else if (article.summary.length < 10 || article.summary.length > 300) {
    result.valid = false;
    result.errors.push('article.summary must be 10-300 characters');
  }

  // Tags
  if (!Array.isArray(article.tags) || article.tags.length < 1) {
    result.valid = false;
    result.errors.push('article.tags must have at least 1 tag');
  }

  // Sources
  validateSources(article.sources, allowlist, result);

  // Body markdown
  if (!article.body_markdown || typeof article.body_markdown !== 'string') {
    result.valid = false;
    result.errors.push('article.body_markdown is required');
  } else if (article.body_markdown.length < 100) {
    result.valid = false;
    result.errors.push('article.body_markdown must be at least 100 characters');
  }

  // Validate payload_hash
  if (!submission.payload_hash || typeof submission.payload_hash !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid payload_hash');
  } else if (!/^sha256:[a-f0-9]{64}$/.test(submission.payload_hash)) {
    result.valid = false;
    result.errors.push('payload_hash must match format: sha256:<64 hex chars>');
  } else {
    const expectedHash = computePayloadHash(submission);
    if (submission.payload_hash !== expectedHash) {
      result.valid = false;
      result.errors.push(
        `payload_hash mismatch:\n  Expected: ${expectedHash}\n  Got: ${submission.payload_hash}`
      );
    }
  }

  // Validate signature format
  if (!submission.signature || typeof submission.signature !== 'string') {
    result.valid = false;
    result.errors.push('Missing or invalid signature');
  } else if (!/^ed25519:[A-Za-z0-9+/=]+$/.test(submission.signature)) {
    result.valid = false;
    result.errors.push('signature must match format: ed25519:<base64>');
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);
  let files: string[];

  if (args.length > 0) {
    files = args;
  } else {
    if (!fs.existsSync(SUBMISSIONS_DIR)) {
      console.log('No submissions directory found.');
      process.exit(0);
    }
    files = fs
      .readdirSync(SUBMISSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(SUBMISSIONS_DIR, f));
  }

  if (files.length === 0) {
    console.log('No submission files to validate.');
    process.exit(0);
  }

  const allowlist = loadAllowlist();
  const results: ValidationResult[] = [];
  let hasErrors = false;

  console.log('Validating submissions...\n');

  for (const file of files) {
    const result = validateSubmission(file, allowlist);
    results.push(result);

    const status = result.valid ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${status} ${path.basename(file)}`);

    if (result.errors.length > 0) {
      hasErrors = true;
      for (const error of result.errors) {
        console.log(`  \x1b[31mError:\x1b[0m ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.log(`  \x1b[33mWarning:\x1b[0m ${warning}`);
      }
    }

    if (result.valid && result.submission) {
      console.log(`  Bot: ${result.submission.bot_id}`);
      console.log(`  Title: ${result.submission.article.title}`);
      console.log(`  Sources: ${result.submission.article.sources.length}`);
    }

    console.log('');
  }

  // Summary
  const validCount = results.filter((r) => r.valid).length;
  const totalCount = results.length;

  console.log('---');
  console.log(`Validated ${totalCount} file(s): ${validCount} valid, ${totalCount - validCount} invalid`);

  process.exit(hasErrors ? 1 : 0);
}

main();
