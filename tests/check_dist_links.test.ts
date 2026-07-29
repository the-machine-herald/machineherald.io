import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseRedirects,
  matchRedirect,
  loadAllowlist,
  resolves,
  checkUrl,
  checkSitemapUrls,
  isMainModule,
  type RedirectRule,
} from '../scripts/check_dist_links';

/** Writes `content` to `dist/relPath`, creating parent directories as needed. */
function writeDistFile(dist: string, relPath: string, content = ''): void {
  const full = join(dist, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

let dist: string;

beforeEach(() => {
  // Fixtures live under a fresh temp directory per test — never in the repo,
  // and never anywhere near the real dist/ that verify:links checks in CI.
  dist = mkdtempSync(join(tmpdir(), 'check-dist-links-'));
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('matchRedirect', () => {
  const rules: RedirectRule[] = [
    { source: '/articles/:year/:slug', destination: '/article/:year/:slug' },
  ];

  it('matches a URL with the right segment count and substitutes placeholders', () => {
    expect(matchRedirect(rules, '/articles/2026-03/some-slug')).toBe(
      '/article/2026-03/some-slug',
    );
  });

  it('does not swallow /articles/2 (one segment) with a two-segment rule', () => {
    // This is the pagination regression: /articles/2, /articles/3, ... must
    // stay untouched by a rule that requires exactly two segments.
    expect(matchRedirect(rules, '/articles/2')).toBeNull();
  });

  it('does not match when a literal segment differs', () => {
    const literalRules: RedirectRule[] = [{ source: '/old/path', destination: '/new/path' }];
    expect(matchRedirect(literalRules, '/old/other')).toBeNull();
  });
});

describe('parseRedirects', () => {
  it('ignores blank lines and comments', () => {
    const rules = parseRedirects(
      '# a comment\n\n/articles/:year/:slug  /article/:year/:slug  301\n',
    );
    expect(rules).toEqual([
      { source: '/articles/:year/:slug', destination: '/article/:year/:slug' },
    ]);
  });
});

describe('resolves / checkUrl — redirect to a missing destination', () => {
  it('still counts as broken when the substituted target does not exist', () => {
    writeDistFile(dist, '_redirects', '/old/:slug  /new/:slug  301\n');
    const redirects: RedirectRule[] = [{ source: '/old/:slug', destination: '/new/:slug' }];
    // Deliberately do NOT create dist/new/something/index.html — the redirect
    // rule matches, but its destination resolves nowhere.
    expect(resolves(dist, '/old/something', redirects)).toBe(false);
    expect(checkUrl(dist, '/old/something', redirects, new Set())).toBe('broken');
  });

  it('resolves true when the substituted destination actually exists', () => {
    writeDistFile(dist, 'new/something/index.html', '<html></html>');
    const redirects: RedirectRule[] = [{ source: '/old/:slug', destination: '/new/:slug' }];
    expect(resolves(dist, '/old/something', redirects)).toBe(true);
    expect(checkUrl(dist, '/old/something', redirects, new Set())).toBe('ok');
  });
});

describe('allowlist', () => {
  it('skips an allowlisted URL, matching exactly and never by prefix', () => {
    const allowlistPath = join(dist, 'known_broken_links.txt');
    writeFileSync(allowlistPath, '# comment\n/dead/link\n');
    const allowlist = loadAllowlist(allowlistPath);

    // dist/ has nothing built, so neither URL resolves on its own — the only
    // thing separating them is the allowlist.
    expect(checkUrl(dist, '/dead/link', [], allowlist)).toBe('allowlisted');
    expect(checkUrl(dist, '/dead/link/extra-segment', [], allowlist)).toBe('broken');
    expect(checkUrl(dist, '/dead/lin', [], allowlist)).toBe('broken');
  });
});

describe('checkSitemapUrls — origin mismatch (Finding 2 regression)', () => {
  it('fails loud instead of silently skipping when a <loc> origin does not match', () => {
    const xml =
      '<urlset><url><loc>https://staging.machineherald.io/about</loc></url></urlset>';
    const result = checkSitemapUrls(xml, dist, 'https://machineherald.io', [], new Set());

    // Nothing was checkable — this must never be reported as a pass.
    expect(result.checked).toBe(0);
    expect(result.broken.size).toBe(1);
    expect(result.broken.has('https://staging.machineherald.io/about')).toBe(true);
  });

  it('checks entries with the matching origin normally alongside a mismatched one', () => {
    writeDistFile(dist, 'about/index.html', '<html></html>');
    const xml = [
      '<urlset>',
      '<url><loc>https://machineherald.io/about</loc></url>',
      '<url><loc>https://wrong-origin.example/missing</loc></url>',
      '</urlset>',
    ].join('');
    const result = checkSitemapUrls(xml, dist, 'https://machineherald.io', [], new Set());

    expect(result.checked).toBe(1); // only the matching-origin entry was checkable
    expect(result.broken.size).toBe(1); // the mismatched one is reported broken
    expect(result.broken.has('https://wrong-origin.example/missing')).toBe(true);
    expect(result.broken.has('/about')).toBe(false);
  });

  it('reports a zero-entry sitemap as zero checked, not a pass', () => {
    const xml = '<urlset></urlset>';
    const result = checkSitemapUrls(xml, dist, 'https://machineherald.io', [], new Set());
    expect(result.checked).toBe(0);
    expect(result.broken.size).toBe(0);
  });
});

describe('isMainModule — entrypoint guard', () => {
  it('is true when argv1 and the module URL refer to the same real file', () => {
    const scriptPath = join(dist, 'entry.ts');
    writeFileSync(scriptPath, '');
    // Node sets import.meta.url to the fully resolved (symlink-free) real
    // path of the entrypoint, so tests simulate it via realpathSync too —
    // dist itself can sit under a symlinked temp dir (e.g. macOS /tmp ->
    // /private/tmp), so a plain pathToFileURL(scriptPath) would not
    // faithfully reproduce what Node actually hands the running script.
    const moduleUrl = pathToFileURL(realpathSync(scriptPath)).href;
    expect(isMainModule(scriptPath, moduleUrl)).toBe(true);
  });

  it('is false when argv1 is a different file than the module URL', () => {
    const scriptPath = join(dist, 'entry.ts');
    const otherPath = join(dist, 'other.ts');
    writeFileSync(scriptPath, '');
    writeFileSync(otherPath, '');
    expect(isMainModule(otherPath, pathToFileURL(scriptPath).href)).toBe(false);
  });

  it('is false when argv1 is undefined', () => {
    expect(isMainModule(undefined, 'file:///anything')).toBe(false);
  });

  it('is false, not throwing, when argv1 names a path that does not exist', () => {
    expect(() => isMainModule(join(dist, 'does-not-exist.ts'), 'file:///anything')).not.toThrow();
    expect(isMainModule(join(dist, 'does-not-exist.ts'), 'file:///anything')).toBe(false);
  });

  it('is true when argv1 is reached through a symlinked directory (the regression case)', () => {
    // Reproduces the failure the reviewer measured: invoking the script
    // through a symlinked directory left both the old naive-string guard and
    // the pathToFileURL-only guard returning false, because import.meta.url
    // is Node's already-resolved real path while argv1 stays the symlink
    // path. realpathSync(argv1) is what makes the two sides comparable.
    const realDir = join(dist, 'real-dir');
    const linkDir = join(dist, 'linked-dir');
    mkdirSync(realDir);
    const scriptPath = join(realDir, 'entry.ts');
    writeFileSync(scriptPath, '');
    symlinkSync(realDir, linkDir);

    const argv1ViaSymlink = join(linkDir, 'entry.ts');
    // What Node would set import.meta.url to: the fully resolved real path
    // (realpath'd, same reasoning as the test above).
    const moduleUrl = pathToFileURL(realpathSync(scriptPath)).href;

    expect(isMainModule(argv1ViaSymlink, moduleUrl)).toBe(true);
  });
});
