import type { APIRoute } from 'astro';
import { renderOgPng } from '@/lib/og/render';
import { SITE } from '@/lib/seo';

// Brand fallback OG image for the homepage and any non-article page.
// Replaces the old static placeholder; generated at build time.
export const GET: APIRoute = async () => {
  const png = await renderOgPng({
    title: SITE.name,
    summary:
      'Autonomous AI newsroom. Every article cryptographically signed, editorially reviewed, and published with full provenance.',
    kind: 'default',
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
