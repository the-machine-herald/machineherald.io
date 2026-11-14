import { describe, it, expect } from 'vitest';
import { allowlistHosts, hostsNotAllowed, normalizeHost } from '../scripts/lib/source_host';

const allowlist = new Set(['isocpp.org', 'web.archive.org', 'lwn.net']);

describe('normalizeHost', () => {
  it('lowercases and strips a leading www only', () => {
    expect(normalizeHost('WWW.LWN.net')).toBe('lwn.net');
    expect(normalizeHost('awww.example.com')).toBe('awww.example.com');
  });
});

describe('allowlistHosts', () => {
  it('returns the plain host for an ordinary URL', () => {
    expect(allowlistHosts('https://www.lwn.net/Articles/1/')).toEqual(['lwn.net']);
  });

  it('returns archive host and origin host for a Wayback capture', () => {
    expect(allowlistHosts('https://web.archive.org/web/20261111193217id_/https://isocpp.org/files/papers/P4454R0.pdf'))
      .toEqual(['web.archive.org', 'isocpp.org']);
  });

  it('accepts a capture without flags and without a scheme', () => {
    expect(allowlistHosts('https://web.archive.org/web/20261108220233/isocpp.org/files/x.pdf'))
      .toEqual(['web.archive.org', 'isocpp.org']);
  });

  it('returns only the archive host when the path is not a capture', () => {
    expect(allowlistHosts('https://web.archive.org/')).toEqual(['web.archive.org']);
  });

  it('returns nothing for an invalid URL', () => {
    expect(allowlistHosts('not a url')).toEqual([]);
  });
});

describe('hostsNotAllowed', () => {
  it('passes a capture of an allowlisted host', () => {
    expect(hostsNotAllowed('https://web.archive.org/web/2026id_/https://lwn.net/a', allowlist)).toEqual([]);
  });

  it('flags a capture of a host that is not allowlisted', () => {
    expect(hostsNotAllowed('https://web.archive.org/web/2026id_/https://example.org/a', allowlist)).toEqual(['example.org']);
  });

  it('flags the archive host itself when it is not allowlisted', () => {
    const noArchive = new Set(['isocpp.org']);
    expect(hostsNotAllowed('https://web.archive.org/web/2026id_/https://isocpp.org/a', noArchive)).toEqual(['web.archive.org']);
  });

  it('flags an ordinary host that is not allowlisted', () => {
    expect(hostsNotAllowed('https://example.org/a', allowlist)).toEqual(['example.org']);
  });
});
