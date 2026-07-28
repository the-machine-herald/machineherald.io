import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OgCardInput } from './render';

/**
 * Build-time cache for Open Graph cards.
 *
 * A card is a pure function of its inputs, and published articles are immutable
 * by design (they are hash-verified and Ed25519-signed), so a rendered PNG never
 * needs regenerating. Cards are stored under a version-scoped directory: bumping
 * OG_CARD_VERSION orphans the whole previous generation at once, which is why no
 * pruning logic is needed here.
 *
 * Bump OG_CARD_VERSION whenever the card design in ./render.ts changes.
 */
export const OG_CARD_VERSION = 1;

const CACHE_DIR = join(process.cwd(), '.cache', 'og', `v${OG_CARD_VERSION}`);

/**
 * Fields are enumerated explicitly rather than JSON.stringify'ing the input, so
 * the key does not depend on property insertion order at the call site.
 */
export function ogCacheKey(input: OgCardInput): string {
  const canonical = JSON.stringify([
    input.title,
    input.summary,
    input.category ?? null,
    input.date ? input.date.toISOString() : null,
    input.model ?? null,
    input.kind ?? 'article',
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export async function renderOgPngCached(input: OgCardInput): Promise<Uint8Array> {
  const file = join(CACHE_DIR, `${ogCacheKey(input)}.png`);
  if (existsSync(file)) {
    return readFileSync(file);
  }

  // Imported lazily so satori and the native resvg binding stay out of this
  // module's graph — it is imported by unit tests that never render anything.
  const { renderOgPng } = await import('./render');
  const png = await renderOgPng(input);

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, png);
  return png;
}
