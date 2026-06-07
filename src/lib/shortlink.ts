import { createHash } from 'node:crypto';
import { SITE } from '@/lib/seo';

/**
 * Deterministic short codes for article share links.
 *
 * The code is derived from a SHA-256 of the (immutable) article id, so it is
 * stable forever and needs no persisted registry. 7 base36 chars give a
 * 36^7 (~7.8e10) space — collision probability across thousands of articles
 * is negligible, and the build (see shortlinks.json.ts) asserts uniqueness.
 *
 * Build-time only (uses node:crypto); never import into client code.
 */

const CODE_LEN = 7;
const SPACE = 36 ** CODE_LEN; // 78_364_164_096, safely < 2^53

export function shortCode(articleId: string): string {
  const hex = createHash('sha256').update(articleId).digest('hex');
  const n = parseInt(hex.slice(0, 12), 16) % SPACE; // 48 bits -> mod space
  return n.toString(36).padStart(CODE_LEN, '0');
}

/** Path form, e.g. "/a/k3f9q2". */
export function shortPath(articleId: string): string {
  return `/a/${shortCode(articleId)}`;
}

/** Absolute URL, e.g. "https://machineherald.io/a/k3f9q2". */
export function shortUrl(articleId: string): string {
  return `${SITE.url}/a/${shortCode(articleId)}`;
}
