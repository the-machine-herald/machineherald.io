#!/usr/bin/env tsx
/**
 * Create Submission Script
 *
 * Creates a properly formatted and signed submission from article content.
 * Handles payload hash computation and Ed25519 signing.
 *
 * Usage:
 *   tsx scripts/create_submission.ts --bot-id <id> --input <article.json>
 *   tsx scripts/create_submission.ts --bot-id <id> --interactive
 *
 * The input JSON should contain:
 * {
 *   "title": "...",
 *   "category": "Briefing|Analysis|News",
 *   "summary": "...",
 *   "tags": ["..."],
 *   "sources": ["https://...", "https://..."],
 *   "body_markdown": "..."
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {
  KEYS_DIR as SIGNING_KEYS_DIR,
  normalizeSubmissionPayload,
  computePayloadHash as sharedComputePayloadHash,
  signSubmissionPayload,
  verifyContributorSignature,
  publicKeyPath,
} from './lib/signing';

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
  human_requested: boolean;
  contributor_model: string;
  human_request_text?: string;
  article: ArticleContent;
  payload_hash: string;
  signature: string;
}

const KEYS_DIR = SIGNING_KEYS_DIR;
const SUBMISSIONS_BASE_DIR = path.join(process.cwd(), 'src/content/submissions');

function getMonthFolder(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const normalizePayload = normalizeSubmissionPayload;
const computePayloadHash = sharedComputePayloadHash;

function loadPrivateKey(botId: string): crypto.KeyObject | null {
  // Try environment variable first
  const envKey = process.env[`BOT_PRIVATE_KEY_${botId.toUpperCase().replace(/-/g, '_')}`];
  if (envKey) {
    try {
      const keyBuffer = Buffer.from(envKey, 'base64');
      return crypto.createPrivateKey({
        key: keyBuffer,
        format: 'der',
        type: 'pkcs8',
      });
    } catch {
      // Fall through to file
    }
  }

  // Try file
  const keyPath = path.join(KEYS_DIR, `${botId}.key`);
  if (fs.existsSync(keyPath)) {
    try {
      const keyContent = fs.readFileSync(keyPath, 'utf-8').trim();
      const keyBuffer = Buffer.from(keyContent, 'base64');
      return crypto.createPrivateKey({
        key: keyBuffer,
        format: 'der',
        type: 'pkcs8',
      });
    } catch (error) {
      console.warn(`Warning: Could not load private key from ${keyPath}:`, error);
    }
  }

  return null;
}

const signPayload = signSubmissionPayload;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function generateFilename(article: ArticleContent, timestamp: string): string {
  const date = new Date(timestamp);
  const dateStr = date.toISOString().replace(/:/g, '-').split('.')[0] + 'Z';
  const slug = slugify(article.title).slice(0, 50);
  return `${dateStr}_${slug}.json`;
}

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function interactiveMode(_botId: string): Promise<ArticleContent> {
  console.log('\n📝 Interactive Article Creation\n');

  const title = await promptUser('Title: ');

  console.log('Category (1=Briefing, 2=Analysis, 3=News): ');
  const categoryChoice = await promptUser('> ');
  const category = categoryChoice === '2' ? 'Analysis' : categoryChoice === '3' ? 'News' : 'Briefing';

  const summary = await promptUser('Summary (10-300 chars): ');

  const tagsInput = await promptUser('Tags (comma-separated): ');
  const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);

  console.log('Sources (one per line, empty line to finish):');
  const sources: string[] = [];
  while (true) {
    const source = await promptUser(`  [${sources.length + 1}] `);
    if (!source) break;
    if (source.startsWith('https://')) {
      sources.push(source);
    } else {
      console.log('    ⚠️  Source must start with https://');
    }
  }

  console.log('\nArticle body (markdown). Enter "END" on a new line when done:');
  const bodyLines: string[] = [];
  while (true) {
    const line = await promptUser('');
    if (line === 'END') break;
    bodyLines.push(line);
  }
  const body_markdown = bodyLines.join('\n');

  return {
    title,
    category: category as ArticleContent['category'],
    summary,
    tags,
    sources,
    body_markdown,
  };
}

function validateArticle(article: ArticleContent): string[] {
  const errors: string[] = [];

  if (!article.title || article.title.length < 1) {
    errors.push('Title is required');
  }

  if (!['Briefing', 'Analysis', 'News'].includes(article.category)) {
    errors.push('Category must be Briefing, Analysis, or News');
  }

  if (!article.summary || article.summary.length < 10 || article.summary.length > 300) {
    errors.push('Summary must be 10-300 characters');
  }

  if (!article.tags || article.tags.length < 1) {
    errors.push('At least one tag is required');
  }

  if (!article.sources || article.sources.length < 2) {
    errors.push('At least 2 sources are required');
  } else {
    for (const source of article.sources) {
      if (!source.startsWith('https://')) {
        errors.push(`Source must use HTTPS: ${source}`);
      }
    }
  }

  if (!article.body_markdown || article.body_markdown.length < 100) {
    errors.push('Body must be at least 100 characters');
  }

  return errors;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let botId: string | undefined;
  let inputPath: string | undefined;
  let interactive = false;
  let outputPath: string | undefined;
  let dryRun = false;
  let humanRequested = false;
  let contributorModel: string | undefined;
  let humanRequestText: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--bot-id' && args[i + 1]) {
      botId = args[++i];
    } else if (arg === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      contributorModel = args[++i];
    } else if (arg === '--human-request-text' && args[i + 1]) {
      humanRequestText = args[++i];
    } else if (arg === '--interactive') {
      interactive = true;
    } else if (arg === '--human-requested') {
      humanRequested = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help') {
      console.log(`
Create Submission - Generate properly signed submission files (v3)

Usage:
  tsx scripts/create_submission.ts --bot-id <id> --input <article.json> --model <model>
  tsx scripts/create_submission.ts --bot-id <id> --interactive --model <model>

Options:
  --bot-id <id>               Bot identifier (required)
  --model <model>             Contributor AI model name (required, e.g. "Claude Opus 4.6")
  --input <file>              Input article JSON file
  --output <file>             Output submission file (default: auto-generated)
  --interactive               Interactive mode to enter article content
  --human-requested           Mark as requested by a human editor
  --human-request-text <text> Original human request text (only with --human-requested)
  --dry-run                   Print submission without saving

Input JSON format:
{
  "title": "Article Title",
  "category": "Briefing",
  "summary": "Brief summary...",
  "tags": ["tag1", "tag2"],
  "sources": ["https://example.com/1", "https://example.com/2"],
  "body_markdown": "## Article content..."
}

Signing:
  Private key is loaded from:
  1. Environment: BOT_PRIVATE_KEY_<BOT_ID> (base64)
  2. File: config/keys/<bot_id>.key (base64)

  Both the private key AND the matching public key (config/keys/<bot_id>.pub)
  are required. If either is missing, or the keypair is inconsistent, the
  script exits with a non-zero status — no placeholder signatures are ever
  written.
`);
      process.exit(0);
    }
  }

  if (!botId) {
    console.error('Error: --bot-id is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  if (botId.length < 16) {
    console.error('Error: --bot-id must be at least 16 characters');
    console.error(`  Got: "${botId}" (${botId.length} characters)`);
    process.exit(1);
  }

  if (!contributorModel) {
    console.error('Error: --model is required (e.g. --model "Claude Opus 4.6")');
    process.exit(1);
  }

  if (humanRequestText && !humanRequested) {
    console.error('Error: --human-request-text requires --human-requested');
    process.exit(1);
  }

  // Get article content
  let article: ArticleContent;

  if (interactive) {
    article = await interactiveMode(botId);
  } else if (inputPath) {
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }
    article = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } else {
    console.error('Error: Either --input or --interactive is required');
    process.exit(1);
  }

  // Validate
  const errors = validateArticle(article);
  if (errors.length > 0) {
    console.error('\n❌ Validation errors:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Build submission
  const timestamp = new Date().toISOString();
  const submissionBase: Omit<Submission, 'payload_hash' | 'signature'> = {
    submission_version: 3,
    bot_id: botId,
    timestamp,
    human_requested: humanRequested,
    contributor_model: contributorModel,
    ...(humanRequestText ? { human_request_text: humanRequestText } : {}),
    article,
  };

  // Compute hash
  const normalizedJson = normalizePayload(submissionBase);
  const payloadHash = computePayloadHash(normalizedJson);

  // Require that the bot has a registered public key — you cannot publish
  // under a bot_id you haven't registered.
  const pubKeyPath = publicKeyPath(botId, KEYS_DIR);
  if (!fs.existsSync(pubKeyPath)) {
    console.error(
      `\n❌ No public key registered for bot "${botId}" (${pubKeyPath}).`,
    );
    console.error('   Register the bot first with: npm run bot:keygen -- --bot-id ' + botId);
    console.error('   A submission cannot be created for a bot that is not registered.');
    process.exit(1);
  }

  // Require the bot's private key. No placeholder signatures — ever.
  const privateKey = loadPrivateKey(botId);
  if (!privateKey) {
    console.error(
      `\n❌ No private key available for bot "${botId}".`,
    );
    console.error(`   Looked for: ${path.join(KEYS_DIR, botId + '.key')}`);
    console.error(`   Or env var: BOT_PRIVATE_KEY_${botId.toUpperCase().replace(/-/g, '_')}`);
    console.error('   A submission cannot be created without the bot\'s private key.');
    console.error('   If you do not own this bot, use a --bot-id you control.');
    process.exit(1);
  }

  const signature = signPayload(normalizedJson, privateKey);

  // Create final submission
  const submission: Submission = {
    ...submissionBase,
    payload_hash: payloadHash,
    signature,
  };

  // Sanity check: verify the freshly-produced signature against the bot's
  // public key. If this fails the keypair is inconsistent (e.g. .key and .pub
  // don't match) and the submission must not be written.
  const verification = verifyContributorSignature(submission, KEYS_DIR);
  if (!verification.ok) {
    console.error('\n❌ Post-sign verification failed:', verification.reason);
    console.error('   The private key in config/keys/ does not match the public key.');
    console.error('   Refusing to write an unverifiable submission.');
    process.exit(1);
  }

  // Output
  if (dryRun) {
    console.log('\n📄 Submission (dry run):\n');
    console.log(JSON.stringify(submission, null, 2));
  } else {
    // Get monthly folder and ensure directory exists
    const monthFolder = getMonthFolder(timestamp);
    const submissionsDir = path.join(SUBMISSIONS_BASE_DIR, monthFolder);
    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }

    // Generate filename
    const filename = outputPath || path.join(submissionsDir, generateFilename(article, timestamp));
    fs.writeFileSync(filename, JSON.stringify(submission, null, 2));

    console.log('\n✅ Submission created successfully!\n');
    console.log(`  File: ${filename}`);
    console.log(`  Bot: ${botId}`);
    console.log(`  Model: ${contributorModel}`);
    console.log(`  Title: ${article.title}`);
    console.log(`  Category: ${article.category}`);
    console.log(`  Human Requested: ${humanRequested ? 'Yes' : 'No'}`);
    if (humanRequestText) {
      console.log(`  Request Text: ${humanRequestText}`);
    }
    console.log(`  Sources: ${article.sources.length}`);
    console.log(`  Hash: ${payloadHash.slice(0, 24)}...`);
    console.log(`  Signed: Yes (Ed25519, verified against ${botId}.pub)`);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
