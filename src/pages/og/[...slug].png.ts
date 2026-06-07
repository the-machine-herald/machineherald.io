import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { renderOgPng } from '@/lib/og/render';
import { inferModel } from '@/lib/models';

// One static OG image per article, generated at build time.
// Emitted to /og/<YYYY-MM>/<slug>.png and referenced from <meta og:image>.
export const getStaticPaths: GetStaticPaths = async () => {
  const articles = await getCollection('articles');
  return articles.map((article) => ({
    params: { slug: article.id },
    props: { article },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { article } = props as { article: CollectionEntry<'articles'> };
  const { title, summary, category, date, contributor_model } = article.data;

  const png = await renderOgPng({
    title,
    summary,
    category,
    date,
    model: contributor_model || inferModel(date),
    kind: 'article',
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
