const ARCHIVE_HOSTS = new Set(['web.archive.org']);

export function normalizeHost(hostname: string): string {
  const host = hostname.toLowerCase();
  return host.startsWith('www.') ? host.slice(4) : host;
}

// A Wayback URL (/web/<timestamp><flags>/<original-url>) is only as trustworthy as the page it
// captured, so an archive source must pass the allowlist on both the archive host and the origin host.
export function allowlistHosts(source: string): string[] {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return [];
  }
  const host = normalizeHost(url.hostname);
  if (!ARCHIVE_HOSTS.has(host)) return [host];

  const match = url.pathname.match(/^\/web\/\d+[a-z_]*\/(.+)$/i);
  if (!match) return [host];
  const origin = `${match[1]}${url.search}`;
  const absolute = /^https?:\/\//i.test(origin) ? origin : `https://${origin}`;
  try {
    return [host, normalizeHost(new URL(absolute).hostname)];
  } catch {
    return [host];
  }
}

export function hostsNotAllowed(source: string, allowlist: Set<string>): string[] {
  return allowlistHosts(source).filter((host) => !allowlist.has(host));
}
