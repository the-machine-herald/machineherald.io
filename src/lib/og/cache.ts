import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/**
 * Guards the one-time `CACHE_DIR` creation so a cold build's ~1,891 misses pay
 * for a single `mkdirSync` instead of one per miss. Deliberately not hoisted to
 * module scope: this module is imported by unit tests that only want the pure
 * `ogCacheKey`/`OG_CARD_VERSION` exports, and importing it should not have the
 * side effect of touching the filesystem.
 */
let cacheDirReady = false;
function ensureCacheDir(): void {
  if (cacheDirReady) return;
  mkdirSync(CACHE_DIR, { recursive: true });
  cacheDirReady = true;
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

  ensureCacheDir();

  // Write to a per-attempt temp file in the same directory, then rename onto
  // the final content-addressed path. Rename is atomic within a filesystem, so
  // a reader (this function's own `existsSync` check above, or any concurrent
  // build process) only ever observes the complete file or no file at all —
  // never a truncated one left behind by a build killed mid-write (Ctrl-C,
  // OOM, SIGKILL). The pid + random suffix keeps concurrent renders of
  // different cards from colliding on the same temp name.
  const tmpFile = join(
    CACHE_DIR,
    `.tmp-${process.pid}-${randomBytes(8).toString('hex')}.png`,
  );
  writeFileSync(tmpFile, png);
  renameSync(tmpFile, file);
  return png;
}
