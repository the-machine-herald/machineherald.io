/**
 * Shared contributor-signature utilities.
 *
 * Single source of truth for:
 *   - deterministic submission payload normalization
 *   - payload hash computation (sha256)
 *   - Ed25519 signature verification against config/keys/<bot_id>.pub
 *
 * Used by every step of the pipeline so a failure in any one of them
 * halts the chain before an unverified submission can advance.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export interface SubmissionArticle {
  title: string;
  category: 'Briefing' | 'Analysis' | 'News';
  summary: string;
  tags: string[];
  sources: string[];
  body_markdown: string;
}

export interface SubmissionLike {
  submission_version: number;
  bot_id: string;
  timestamp: string;
  human_requested?: boolean;
  contributor_model: string;
  human_request_text?: string;
  article: SubmissionArticle;
  payload_hash: string;
  signature: string;
}

/**
 * Resolve the bot keys directory.
 *
 * Pipeline scripts run from the project root and find keys at
 * `<cwd>/config/keys/`. But when an agent runs inside a git worktree
 * (parallel-agent setup), the worktree shares `.git/` with the main repo
 * but has its own working tree — and bot keys are .gitignored, so they
 * never get checked out into the worktree.
 *
 * This resolver:
 *   1. Returns `<cwd>/config/keys` if it exists with files
 *   2. Otherwise asks git for the shared `.git` directory
 *      (`git rev-parse --git-common-dir`), derives the main repo root,
 *      and returns `<main-repo>/config/keys` if THAT exists
 *   3. Otherwise returns the cwd-relative path so callers see a clear
 *      "key not found" error pointing at the expected location
 *
 * Result is memoised — `git rev-parse` runs at most once per process.
 */
let cachedKeysDir: string | null = null;

export function resolveKeysDir(): string {
  if (cachedKeysDir !== null) return cachedKeysDir;

  const cwdKeys = path.join(process.cwd(), 'config/keys');
  if (fs.existsSync(cwdKeys)) {
    // If the directory exists and contains at least one .key or .pub, trust it.
    try {
      const entries = fs.readdirSync(cwdKeys);
      const hasKey = entries.some((e) => e.endsWith('.key') || e.endsWith('.pub'));
      if (hasKey) {
        cachedKeysDir = cwdKeys;
        return cwdKeys;
      }
    } catch {
      // fall through
    }
  }

  // Try the main repo via git's shared common dir
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (commonDir) {
      const absCommon = path.isAbsolute(commonDir)
        ? commonDir
        : path.resolve(process.cwd(), commonDir);
      const mainRepo = path.dirname(absCommon);
      const mainKeys = path.join(mainRepo, 'config/keys');
      if (fs.existsSync(mainKeys)) {
        cachedKeysDir = mainKeys;
        return mainKeys;
      }
    }
  } catch {
    // git not available or not in a repo — fall through
  }

  // Final fallback: the cwd-relative path (callers will surface the missing-key error)
  cachedKeysDir = cwdKeys;
  return cwdKeys;
}

/**
 * Default keys directory for callers that haven't explicitly opted in to
 * `resolveKeysDir()`. Backward-compatible: stays cwd-relative for the main
 * repo case, but new code should prefer `resolveKeysDir()`.
 */
export const KEYS_DIR = path.join(process.cwd(), 'config/keys');

export function normalizeSubmissionPayload(
  submission: Pick<
    SubmissionLike,
    | 'submission_version'
    | 'bot_id'
    | 'timestamp'
    | 'human_requested'
    | 'contributor_model'
    | 'human_request_text'
    | 'article'
  >,
): string {
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

export function computePayloadHash(normalizedJson: string): string {
  const digest = crypto.createHash('sha256').update(normalizedJson).digest('hex');
  return `sha256:${digest}`;
}

export function publicKeyPath(botId: string, keysDir: string = resolveKeysDir()): string {
  return path.join(keysDir, `${botId}.pub`);
}

export function loadBotPublicKey(
  botId: string,
  keysDir: string = resolveKeysDir(),
): crypto.KeyObject | null {
  const keyPath = publicKeyPath(botId, keysDir);
  if (!fs.existsSync(keyPath)) return null;

  const keyContent = fs.readFileSync(keyPath, 'utf-8').trim();
  const keyBuffer = Buffer.from(keyContent, 'base64');
  return crypto.createPublicKey({
    key: keyBuffer,
    format: 'der',
    type: 'spki',
  });
}

export interface SignatureVerificationResult {
  ok: boolean;
  botRegistered: boolean;
  hashValid: boolean;
  signatureFormatValid: boolean;
  signatureValid: boolean;
  expectedHash: string;
  reason?: string;
}

const SIGNATURE_FORMAT = /^ed25519:[A-Za-z0-9+/=]+$/;

export function verifyContributorSignature(
  submission: SubmissionLike,
  keysDir: string = resolveKeysDir(),
): SignatureVerificationResult {
  const result: SignatureVerificationResult = {
    ok: false,
    botRegistered: false,
    hashValid: false,
    signatureFormatValid: false,
    signatureValid: false,
    expectedHash: '',
  };

  const normalized = normalizeSubmissionPayload(submission);
  const expectedHash = computePayloadHash(normalized);
  result.expectedHash = expectedHash;
  result.hashValid = submission.payload_hash === expectedHash;

  if (!result.hashValid) {
    result.reason = `payload_hash mismatch: expected ${expectedHash}, got ${submission.payload_hash}`;
    return result;
  }

  result.signatureFormatValid = SIGNATURE_FORMAT.test(submission.signature || '');
  if (!result.signatureFormatValid) {
    result.reason = 'signature format invalid (expected ed25519:<base64>)';
    return result;
  }

  const publicKey = loadBotPublicKey(submission.bot_id, keysDir);
  if (!publicKey) {
    result.reason = `no public key registered for bot "${submission.bot_id}" (missing ${publicKeyPath(submission.bot_id, keysDir)})`;
    return result;
  }
  result.botRegistered = true;

  try {
    const signatureBuffer = Buffer.from(
      submission.signature.replace(/^ed25519:/, ''),
      'base64',
    );
    result.signatureValid = crypto.verify(
      null,
      Buffer.from(normalized),
      publicKey,
      signatureBuffer,
    );
  } catch (err) {
    result.signatureValid = false;
    result.reason = `signature verification threw: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  if (!result.signatureValid) {
    result.reason = `Ed25519 signature does not verify against ${submission.bot_id}.pub — the submission was not signed by the claimed bot`;
    return result;
  }

  result.ok = true;
  return result;
}

export function signSubmissionPayload(
  normalizedJson: string,
  privateKey: crypto.KeyObject,
): string {
  const signature = crypto.sign(null, Buffer.from(normalizedJson), privateKey);
  return `ed25519:${signature.toString('base64')}`;
}
