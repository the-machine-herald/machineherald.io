/**
 * Cloudflare Pages Function: short-link resolver.
 *
 * Resolves /a/<code> to its canonical article and issues a real 301 redirect.
 * The code->path map is the build-time generated static asset /shortlinks.json,
 * fetched once per warm isolate and cached in module scope.
 *
 * This directory (functions/) is auto-detected and deployed by Cloudflare Pages
 * on every build — no dashboard configuration is required.
 */

let mapPromise = null;

function loadMap(context) {
  if (!mapPromise) {
    const url = new URL('/shortlinks.json', context.request.url).toString();
    // env.ASSETS serves this deployment's static files directly (no CDN round-trip);
    // fall back to a same-origin fetch when the binding is absent.
    const assetFetch =
      context.env && context.env.ASSETS
        ? (req) => context.env.ASSETS.fetch(req)
        : (req) => fetch(req);
    mapPromise = assetFetch(new Request(url))
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return mapPromise;
}

// onRequest handles GET and HEAD (crawlers / social unfurlers issue both).
export async function onRequest(context) {
  const code = String(context.params.code || '').toLowerCase();
  const map = await loadMap(context);
  const target = map[code];

  if (!target) {
    return new Response('Short link not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const dest = new URL(target, context.request.url).toString();
  return new Response(null, {
    status: 301,
    headers: {
      Location: dest,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
