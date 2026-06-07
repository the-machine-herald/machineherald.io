import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { shortCode } from '@/lib/shortlink';

// Build-time generated map: short code -> canonical article path.
// Consumed at the edge by functions/a/[code].js to issue 301 redirects.
export const GET: APIRoute = async () => {
  const articles = await getCollection('articles');
  const map: Record<string, string> = {};

  for (const article of articles) {
    const code = shortCode(article.id);
    const target = `/article/${article.id}`;
    if (map[code] && map[code] !== target) {
      throw new Error(
        `Short code collision on "${code}": ${map[code]} vs ${target}. ` +
          `Increase CODE_LEN in src/lib/shortlink.ts.`
      );
    }
    map[code] = target;
  }

  return new Response(JSON.stringify(map), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
