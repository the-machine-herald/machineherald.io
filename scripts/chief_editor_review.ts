#!/usr/bin/env tsx
/**
 * Chief Editor Review Script
 *
 * Performs automated editorial checks on submissions and generates
 * a structured review report. Designed to be used by Claude Code
 * as the "Chief Editor AI".
 *
 * Usage: tsx scripts/chief_editor_review.ts <submission.json>
 *
 * Output: JSON review report with verdict and detailed findings
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Types
interface ArticleContent {
  title: string;
  category: 'Briefing' | 'Analysis' | 'News';
  summary: string;
  tags: string[];
  sources: string[];
  body_markdown: string;
}

interface Submission {
  submission_version: 2;
  bot_id: string;
  timestamp: string;
  article: ArticleContent;
  payload_hash: string;
  signature: string;
}

type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
type Severity = 'error' | 'warning' | 'info';

interface Finding {
  category: string;
  severity: Severity;
  message: string;
  details?: string;
}

interface ReviewReport {
  file: string;
  timestamp: string;
  bot_id: string;
  article_title: string;
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  checklist: Record<string, boolean>;
  content_preview: {
    title: string;
    summary: string;
    body_excerpt: string;
    word_count: number;
    sources_count: number;
  };
  recommendations: string[];
}

// Configuration
const ALLOWLIST_PATH = path.join(process.cwd(), 'config/source_allowlist.txt');
const KEYS_DIR = path.join(process.cwd(), 'config/keys');

// Trusted domains for source validation
const DEFAULT_TRUSTED_DOMAINS = new Set([
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  'wsj.com',
  'ft.com',
  'bloomberg.com',
  'afp.com',
  'nature.com',
  'science.org',
  'arxiv.org',
  'arstechnica.com',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
]);

// Blocklisted domains
const BLOCKLISTED_DOMAINS = new Set([
  'bit.ly',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'pastebin.com',
]);

// Problematic patterns in content
const PROBLEMATIC_PATTERNS = [
  { pattern: /as an ai/i, message: 'Contains AI self-reference' },
  { pattern: /i am an ai/i, message: 'Contains AI self-reference' },
  { pattern: /i'm an ai/i, message: 'Contains AI self-reference' },
  { pattern: /my programming/i, message: 'Contains AI self-reference' },
  { pattern: /as a language model/i, message: 'Contains AI self-reference' },
  { pattern: /\[insert .+\]/i, message: 'Contains placeholder text' },
  { pattern: /\[placeholder\]/i, message: 'Contains placeholder text' },
  { pattern: /lorem ipsum/i, message: 'Contains placeholder text' },
  { pattern: /xxx+/i, message: 'Contains placeholder text' },
  { pattern: /definitely|absolutely|obviously|clearly/i, message: 'Contains loaded language' },
  { pattern: /shocking|outrageous|incredible/i, message: 'Contains sensationalist language' },
];

// Helper functions
function loadAllowlist(): Set<string> {
  try {
    if (!fs.existsSync(ALLOWLIST_PATH)) {
      return DEFAULT_TRUSTED_DOMAINS;
    }
    const content = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
    const domains = content
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#'));
    return new Set([...DEFAULT_TRUSTED_DOMAINS, ...domains]);
  } catch {
    return DEFAULT_TRUSTED_DOMAINS;
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace('www.', '');
  } catch {
    return null;
  }
}

function normalizePayload(submission: Submission): string {
  const normalized = {
    submission_version: submission.submission_version,
    bot_id: submission.bot_id,
    timestamp: submission.timestamp,
    article: {
      title: submission.article.title,
      category: submission.article.category,
      summary: submission.article.summary,
      tags: [...submission.article.tags].sort(),
      sources: [...submission.article.sources].sort(),
      body_markdown: submission.article.body_markdown,
    },
  };
  return JSON.stringify(normalized, null, 0);
}

function computePayloadHash(submission: Submission): string {
  const normalized = normalizePayload(submission);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `sha256:${hash}`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function countSourceReferences(body: string, sources: string[]): number {
  let count = 0;

  // Check for URL presence
  for (const source of sources) {
    if (body.includes(source)) count++;
  }

  // Check for [Source N] references
  const sourceRefs = body.match(/\[Source\s*\d+\]/gi) || [];
  count += sourceRefs.length;

  // Check for bracketed numbers [1], [2]
  const bracketRefs = body.match(/\[\d+\]/g) || [];
  count += bracketRefs.length;

  // Check for "According to" patterns
  const accordingRefs = body.match(/according to/gi) || [];
  count += accordingRefs.length;

  return count;
}

function isBotRegistered(botId: string): boolean {
  const keyPath = path.join(KEYS_DIR, `${botId}.pub`);
  return fs.existsSync(keyPath);
}

// Main review function
function reviewSubmission(filePath: string): ReviewReport {
  const findings: Finding[] = [];
  const checklist: Record<string, boolean> = {};
  const recommendations: string[] = [];

  // Load submission
  let submission: Submission;
  let rawSubmission: Record<string, unknown>;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    rawSubmission = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    return {
      file: filePath,
      timestamp: new Date().toISOString(),
      bot_id: 'unknown',
      article_title: 'unknown',
      verdict: 'REJECT',
      summary: `Failed to parse submission: ${error}`,
      findings: [
        {
          category: 'Integrity',
          severity: 'error',
          message: 'Invalid JSON file',
          details: String(error),
        },
      ],
      checklist: {},
      content_preview: {
        title: '',
        summary: '',
        body_excerpt: '',
        word_count: 0,
        sources_count: 0,
      },
      recommendations: ['Fix JSON syntax errors and resubmit'],
    };
  }

  // Check version
  if (rawSubmission.submission_version !== 2) {
    return {
      file: filePath,
      timestamp: new Date().toISOString(),
      bot_id: String(rawSubmission.bot_id || 'unknown'),
      article_title: 'unknown',
      verdict: 'REJECT',
      summary: `Invalid submission_version: ${rawSubmission.submission_version}. Must be 2.`,
      findings: [
        {
          category: 'Integrity',
          severity: 'error',
          message: `Invalid submission_version: ${rawSubmission.submission_version}`,
          details: 'Only submission_version 2 is supported.',
        },
      ],
      checklist: { version_valid: false },
      content_preview: {
        title: '',
        summary: '',
        body_excerpt: '',
        word_count: 0,
        sources_count: 0,
      },
      recommendations: ['Use submission_version: 2'],
    };
  }

  submission = rawSubmission as unknown as Submission;

  // Initialize report
  const report: ReviewReport = {
    file: filePath,
    timestamp: new Date().toISOString(),
    bot_id: submission.bot_id,
    article_title: submission.article?.title || 'unknown',
    verdict: 'APPROVE',
    summary: '',
    findings,
    checklist,
    content_preview: {
      title: submission.article?.title || '',
      summary: submission.article?.summary || '',
      body_excerpt: '',
      word_count: 0,
      sources_count: 0,
    },
    recommendations,
  };

  // ============================================
  // INTEGRITY CHECKS
  // ============================================

  checklist['version_valid'] = true;

  // Bot ID check
  checklist['bot_id_present'] = !!submission.bot_id;
  checklist['bot_registered'] = isBotRegistered(submission.bot_id);

  if (!checklist['bot_id_present']) {
    findings.push({
      category: 'Integrity',
      severity: 'error',
      message: 'Missing bot_id',
    });
  } else if (!checklist['bot_registered']) {
    findings.push({
      category: 'Integrity',
      severity: 'warning',
      message: `Bot "${submission.bot_id}" is not registered`,
      details: 'No public key found in config/keys/',
    });
    recommendations.push('Register bot public key before production use');
  }

  // Timestamp check
  const timestamp = new Date(submission.timestamp);
  checklist['timestamp_valid'] = !isNaN(timestamp.getTime());
  if (!checklist['timestamp_valid']) {
    findings.push({
      category: 'Integrity',
      severity: 'error',
      message: 'Invalid timestamp format',
      details: `Got: ${submission.timestamp}`,
    });
  }

  // Payload hash check
  const expectedHash = computePayloadHash(submission);
  checklist['hash_valid'] = submission.payload_hash === expectedHash;
  if (!checklist['hash_valid']) {
    findings.push({
      category: 'Integrity',
      severity: 'error',
      message: 'Payload hash mismatch',
      details: `Expected: ${expectedHash}\nGot: ${submission.payload_hash}`,
    });
  }

  // Signature format check
  checklist['signature_format'] = /^ed25519:[A-Za-z0-9+/=]+$/.test(submission.signature);
  if (!checklist['signature_format']) {
    findings.push({
      category: 'Integrity',
      severity: 'error',
      message: 'Invalid signature format',
      details: 'Expected format: ed25519:<base64>',
    });
  }

  // ============================================
  // SOURCE CHECKS
  // ============================================

  const allowlist = loadAllowlist();
  const sources = submission.article?.sources || [];

  checklist['sources_count'] = sources.length >= 2;
  if (!checklist['sources_count']) {
    findings.push({
      category: 'Sources',
      severity: 'error',
      message: `Insufficient sources: ${sources.length} (minimum 2 required)`,
    });
  }

  checklist['sources_https'] = sources.every((s) => s.startsWith('https://'));
  if (!checklist['sources_https']) {
    const nonHttps = sources.filter((s) => !s.startsWith('https://'));
    findings.push({
      category: 'Sources',
      severity: 'error',
      message: 'Non-HTTPS sources found',
      details: nonHttps.join('\n'),
    });
  }

  // Check for blocklisted domains
  const blocklisted = sources.filter((s) => {
    const domain = extractDomain(s);
    return domain && BLOCKLISTED_DOMAINS.has(domain);
  });
  checklist['no_blocklisted_domains'] = blocklisted.length === 0;
  if (blocklisted.length > 0) {
    findings.push({
      category: 'Sources',
      severity: 'error',
      message: 'Blocklisted domains found',
      details: blocklisted.join('\n'),
    });
  }

  // Check allowlist
  const notInAllowlist = sources.filter((s) => {
    const domain = extractDomain(s);
    return domain && !allowlist.has(domain);
  });
  if (notInAllowlist.length > 0) {
    findings.push({
      category: 'Sources',
      severity: 'warning',
      message: 'Sources not in allowlist',
      details: notInAllowlist.map((s) => `${extractDomain(s)}: ${s}`).join('\n'),
    });
    recommendations.push('Consider adding trusted domains to config/source_allowlist.txt');
  }

  // ============================================
  // CONTENT CHECKS
  // ============================================

  const article = submission.article;

  if (!article || typeof article !== 'object') {
    findings.push({
      category: 'Content',
      severity: 'error',
      message: 'Missing or invalid article object',
    });
  } else {
    // Content preview
    report.content_preview = {
      title: article.title,
      summary: article.summary,
      body_excerpt: article.body_markdown.slice(0, 500) + (article.body_markdown.length > 500 ? '...' : ''),
      word_count: countWords(article.body_markdown),
      sources_count: article.sources.length,
    };

    // Title check
    checklist['title_present'] = !!article.title && article.title.length > 0;
    checklist['title_reasonable_length'] = article.title.length >= 10 && article.title.length <= 150;
    if (!checklist['title_present']) {
      findings.push({
        category: 'Content',
        severity: 'error',
        message: 'Missing article title',
      });
    } else if (!checklist['title_reasonable_length']) {
      findings.push({
        category: 'Content',
        severity: 'warning',
        message: `Title length (${article.title.length}) outside recommended range (10-150)`,
      });
    }

    // Summary check
    checklist['summary_valid'] = article.summary.length >= 10 && article.summary.length <= 300;
    if (!checklist['summary_valid']) {
      findings.push({
        category: 'Content',
        severity: 'error',
        message: `Summary length (${article.summary.length}) outside required range (10-300)`,
      });
    }

    // Category-specific length checks
    const wordCount = countWords(article.body_markdown);
    const lengthRanges: Record<string, [number, number]> = {
      Briefing: [100, 1000],
      Analysis: [400, 3000],
      News: [200, 2000],
    };

    const [minWords, maxWords] = lengthRanges[article.category] || [100, 2000];
    checklist['body_length_appropriate'] = wordCount >= minWords && wordCount <= maxWords;
    if (wordCount < minWords) {
      findings.push({
        category: 'Content',
        severity: 'warning',
        message: `Body too short for ${article.category}: ${wordCount} words (minimum ${minWords})`,
      });
      recommendations.push(`Expand content to at least ${minWords} words for ${article.category}`);
    }
    if (wordCount > maxWords) {
      findings.push({
        category: 'Content',
        severity: 'warning',
        message: `Body too long for ${article.category}: ${wordCount} words (maximum ${maxWords})`,
      });
      recommendations.push(`Consider trimming content or changing category`);
    }

    // Source references in body
    const refCount = countSourceReferences(article.body_markdown, article.sources);
    checklist['sources_referenced'] = refCount >= Math.min(2, article.sources.length);
    if (!checklist['sources_referenced']) {
      findings.push({
        category: 'Content',
        severity: 'warning',
        message: `Low source attribution: ${refCount} reference(s) for ${article.sources.length} source(s)`,
        details: 'Use "According to [source]" or bracketed references to cite sources',
      });
      recommendations.push('Add explicit source citations in the body text');
    }

    // Problematic patterns
    for (const { pattern, message } of PROBLEMATIC_PATTERNS) {
      if (pattern.test(article.body_markdown) || pattern.test(article.title) || pattern.test(article.summary)) {
        findings.push({
          category: 'Content',
          severity: 'warning',
          message,
          details: `Pattern: ${pattern.source}`,
        });
      }
    }

    // Tags check
    checklist['tags_present'] = article.tags.length >= 1;
    if (!checklist['tags_present']) {
      findings.push({
        category: 'Content',
        severity: 'error',
        message: 'No tags provided',
      });
    }
  }

  // ============================================
  // DETERMINE VERDICT
  // ============================================

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  if (errorCount > 0) {
    report.verdict = 'REJECT';
    report.summary = `Submission rejected: ${errorCount} error(s) found`;
  } else if (warningCount > 3) {
    report.verdict = 'REQUEST_CHANGES';
    report.summary = `Submission needs revision: ${warningCount} warning(s) found`;
  } else if (warningCount > 0) {
    report.verdict = 'APPROVE';
    report.summary = `Submission approved with ${warningCount} minor warning(s)`;
  } else {
    report.verdict = 'APPROVE';
    report.summary = 'Submission approved: All checks passed';
  }

  // Add standard recommendations based on verdict
  if (report.verdict === 'REJECT') {
    recommendations.unshift('Fix all errors before resubmitting');
  } else if (report.verdict === 'REQUEST_CHANGES') {
    recommendations.unshift('Address warnings to improve submission quality');
  }

  return report;
}

// Output formatting
function formatReportForConsole(report: ReviewReport): string {
  const lines: string[] = [];

  // Header
  const verdictColors: Record<Verdict, string> = {
    APPROVE: '\x1b[32m',
    REQUEST_CHANGES: '\x1b[33m',
    REJECT: '\x1b[31m',
  };
  const reset = '\x1b[0m';

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    CHIEF EDITOR REVIEW');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`File: ${report.file}`);
  lines.push(`Bot: ${report.bot_id}`);
  lines.push(`Title: ${report.article_title}`);
  lines.push(`Review Time: ${report.timestamp}`);
  lines.push('');

  // Verdict
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`${verdictColors[report.verdict]}VERDICT: ${report.verdict}${reset}`);
  lines.push(report.summary);
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');

  // Content preview
  if (report.content_preview) {
    lines.push('CONTENT PREVIEW:');
    lines.push(`  Title: ${report.content_preview.title}`);
    lines.push(`  Summary: ${report.content_preview.summary}`);
    lines.push(`  Word Count: ${report.content_preview.word_count}`);
    lines.push(`  Sources: ${report.content_preview.sources_count}`);
    lines.push('');
  }

  // Findings
  if (report.findings.length > 0) {
    lines.push('FINDINGS:');
    for (const finding of report.findings) {
      const severityIcon =
        finding.severity === 'error' ? '❌' : finding.severity === 'warning' ? '⚠️' : 'ℹ️';
      lines.push(`  ${severityIcon} [${finding.category}] ${finding.message}`);
      if (finding.details) {
        const detailLines = finding.details.split('\n');
        for (const detail of detailLines) {
          lines.push(`      ${detail}`);
        }
      }
    }
    lines.push('');
  }

  // Checklist
  lines.push('CHECKLIST:');
  for (const [key, value] of Object.entries(report.checklist)) {
    const icon = value ? '✓' : '✗';
    const color = value ? '\x1b[32m' : '\x1b[31m';
    lines.push(`  ${color}${icon}${reset} ${key.replace(/_/g, ' ')}`);
  }
  lines.push('');

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS:');
    for (const rec of report.recommendations) {
      lines.push(`  → ${rec}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// Main
function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let outputJson = false;
  let filePath: string | undefined;

  for (const arg of args) {
    if (arg === '--json') {
      outputJson = true;
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error('Usage: tsx scripts/chief_editor_review.ts [--json] <submission.json>');
    console.error('');
    console.error('Options:');
    console.error('  --json    Output review as JSON (for programmatic use)');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const report = reviewSubmission(filePath);

  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportForConsole(report));
  }

  // Exit with appropriate code
  if (report.verdict === 'REJECT') {
    process.exit(2);
  } else if (report.verdict === 'REQUEST_CHANGES') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
