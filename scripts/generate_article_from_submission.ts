#!/usr/bin/env tsx
/**
 * Generate Article from Submission
 *
 * Takes a validated submission JSON and generates:
 * 1. An article markdown file in src/content/articles/
 * 2. A provenance JSON file in src/content/provenance/
 *
 * Extracts the article content directly from the submission (bot-authored).
 *
 * Usage: tsx scripts/generate_article_from_submission.ts <submission.json>
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

interface Provenance {
  article_sha256: string;
  submission_hash: string;
  bot_id: string;
  publisher_job_id: string;
  pipeline_version: string;
  sources: string[];
  created_at: string;
  human_requested: boolean;
  contributor_model: string;
  human_request_text?: string;
  signatures_present: {
    contributor: boolean;
    publisher: boolean;
  };
  provenance_signature?: string;
  pr_number?: number;
  pr_url?: string;
}

const ARTICLES_BASE_DIR = path.join(process.cwd(), 'src/content/articles');
const PROVENANCE_BASE_DIR = path.join(process.cwd(), 'src/content/provenance');

function getPipelineVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    );
    return packageJson.version || '3.0.0';
  } catch {
    return '3.0.0';
  }
}

function getPublisherJobId(): string {
  return process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function getMonthFolder(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function generateSlug(submission: Submission): string {
  const date = new Date(submission.timestamp);
  const monthFolder = getMonthFolder(submission.timestamp);
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${monthFolder}/${day}-${slugify(submission.article.title)}`;
}

function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function signProvenance(provenance: Provenance): Promise<string | undefined> {
  const privateKeyBase64 = process.env.PUBLISHER_PRIVATE_KEY;

  if (!privateKeyBase64) {
    console.warn('Warning: PUBLISHER_PRIVATE_KEY not set. Using HMAC fallback.');
    const secret = process.env.PUBLISHER_SECRET || 'development-secret';
    const data = JSON.stringify(provenance, Object.keys(provenance).sort());
    const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64');
    return `hmac-sha256:${hmac}`;
  }

  try {
    const privateKey = Buffer.from(privateKeyBase64, 'base64');
    const data = JSON.stringify(provenance, Object.keys(provenance).sort());

    const keyObject = crypto.createPrivateKey({
      key: privateKey,
      format: 'der',
      type: 'pkcs8',
    });

    const signature = crypto.sign(null, Buffer.from(data), keyObject);
    return `ed25519:${signature.toString('base64')}`;
  } catch (error) {
    console.warn('Warning: Ed25519 signing failed, using HMAC fallback:', error);
    const secret = process.env.PUBLISHER_SECRET || 'development-secret';
    const data = JSON.stringify(provenance, Object.keys(provenance).sort());
    const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64');
    return `hmac-sha256:${hmac}`;
  }
}

function generateFrontmatter(submission: Submission, slug: string): string {
  const date = new Date(submission.timestamp);
  const { article } = submission;

  const frontmatterObj = {
    title: article.title,
    date: date.toISOString(),
    tags: article.tags,
    category: article.category,
    summary: article.summary,
    sources: article.sources,
    provenance_id: slug,
    author_bot_id: submission.bot_id,
    draft: false,
    human_requested: !!submission.human_requested,
    contributor_model: submission.contributor_model,
  };

  return `---\n${Object.entries(frontmatterObj)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
      }
      if (typeof value === 'string' && (value.includes(':') || value.includes('"'))) {
        return `${key}: "${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}: ${value}`;
    })
    .join('\n')}\n---\n\n`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error('Usage: tsx scripts/generate_article_from_submission.ts <submission.json>');
    process.exit(1);
  }

  const submissionPath = args[0]!;

  if (!fs.existsSync(submissionPath)) {
    console.error(`Submission file not found: ${submissionPath}`);
    process.exit(1);
  }

  const submission: Submission = JSON.parse(fs.readFileSync(submissionPath, 'utf-8'));

  // Validate version
  if (submission.submission_version !== 3) {
    console.error(`Invalid submission_version: ${submission.submission_version}. Must be 3.`);
    process.exit(1);
  }

  console.log('Processing submission...');

  // Generate slug
  const slug = generateSlug(submission);
  console.log(`Generating article with slug: ${slug}`);

  // Generate article content
  const frontmatter = generateFrontmatter(submission, slug);
  const articleContent = frontmatter + submission.article.body_markdown;

  // Compute article hash
  const articleHash = computeSha256(articleContent);

  // Create provenance record
  const provenance: Provenance = {
    article_sha256: articleHash,
    submission_hash: submission.payload_hash.replace('sha256:', ''),
    bot_id: submission.bot_id,
    publisher_job_id: getPublisherJobId(),
    pipeline_version: getPipelineVersion(),
    sources: submission.article.sources,
    created_at: new Date().toISOString(),
    human_requested: !!submission.human_requested,
    contributor_model: submission.contributor_model,
    ...(submission.human_request_text ? { human_request_text: submission.human_request_text } : {}),
    signatures_present: {
      contributor: !!submission.signature,
      publisher: false,
    },
    pr_number: process.env.GITHUB_PR_NUMBER ? parseInt(process.env.GITHUB_PR_NUMBER, 10) : undefined,
    pr_url: process.env.GITHUB_PR_URL || undefined,
  };

  // Sign provenance
  const provenanceSignature = await signProvenance(provenance);
  if (provenanceSignature) {
    provenance.provenance_signature = provenanceSignature;
    provenance.signatures_present.publisher = true;
  }

  // Get month folder from slug (e.g., "2026-02/05-article" -> "2026-02")
  const monthFolder = slug.split('/')[0];
  const filename = slug.split('/')[1];

  // Ensure directories exist (including month subfolders)
  const articlesDir = path.join(ARTICLES_BASE_DIR, monthFolder!);
  const provenanceDir = path.join(PROVENANCE_BASE_DIR, monthFolder!);

  if (!fs.existsSync(articlesDir)) {
    fs.mkdirSync(articlesDir, { recursive: true });
  }
  if (!fs.existsSync(provenanceDir)) {
    fs.mkdirSync(provenanceDir, { recursive: true });
  }

  // Write article
  const articlePath = path.join(articlesDir, `${filename}.md`);
  fs.writeFileSync(articlePath, articleContent);
  console.log(`Article written to: ${articlePath}`);

  // Write provenance
  const provenancePath = path.join(provenanceDir, `${filename}.json`);
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
  console.log(`Provenance written to: ${provenancePath}`);

  // Output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `slug=${slug}\narticle_path=${articlePath}\nprovenance_path=${provenancePath}\n`
    );
  }

  console.log('\nGeneration complete!');
  console.log(`  Slug: ${slug}`);
  console.log(`  Article hash: ${articleHash.slice(0, 16)}...`);
  console.log(`  Bot: ${submission.bot_id}`);
  console.log(`  Sources: ${submission.article.sources.length}`);
  console.log(`  Content: ${submission.article.body_markdown.length} chars`);
  console.log(`  Publisher signature: ${provenance.signatures_present.publisher ? 'Present' : 'Not present'}`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
