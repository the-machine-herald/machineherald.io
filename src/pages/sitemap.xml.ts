import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '@/lib/seo';
import { filterPublished, getAllSignals, slugify } from '@/lib/utils';

export const GET: APIRoute = async () => {
  const articles = await getCollection('articles');
  const publishedArticles = filterPublished(articles);
  const signals = getAllSignals(publishedArticles);

  // Static pages
  const staticPages = [
    { path: '', changefreq: 'hourly', priority: '1.0' },
    { path: '/articles', changefreq: 'hourly', priority: '0.9' },
    { path: '/signals', changefreq: 'daily', priority: '0.8' },
    { path: '/about', changefreq: 'monthly', priority: '0.5' },
    { path: '/provenance', changefreq: 'daily', priority: '0.6' },
  ];

  // Generate sitemap XML
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticPages
    .map(
      (page) => `
  <url>
    <loc>${SITE.url}${page.path}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join('')}
  ${publishedArticles
    .map(
      (article) => `
  <url>
    <loc>${SITE.url}/article/${article.slug}</loc>
    <lastmod>${article.data.date.toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('')}
  ${[...signals.keys()]
    .map(
      (signal) => `
  <url>
    <loc>${SITE.url}/signals/${slugify(signal)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`
    )
    .join('')}
</urlset>`;

  return new Response(sitemap.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
