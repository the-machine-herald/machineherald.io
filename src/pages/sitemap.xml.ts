import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '@/lib/seo';
import { filterPublished } from '@/lib/utils';
import { getArticlesWithMeta, getTopicHierarchy, topicSlug, subcategorySlug } from '@/lib/article-meta';
import { getSignalIndex, getSourceIndex } from '@/lib/taxonomy-index';

export const GET: APIRoute = async () => {
  const articles = await getCollection('articles');
  const publishedArticles = filterPublished(articles);
  const signalIndex = await getSignalIndex();
  const sourceIndex = await getSourceIndex();

  // Get unique authors
  const authors = new Set<string>();
  publishedArticles.forEach((article) => {
    if (article.data.author_bot_id) {
      authors.add(article.data.author_bot_id);
    }
  });

  // Topics
  const allWithMeta = await getArticlesWithMeta();
  const published = allWithMeta.filter((a) => !a.article.data.draft);
  const hierarchy = getTopicHierarchy(published);

  // Static pages
  const staticPages = [
    { path: '', changefreq: 'hourly', priority: '1.0' },
    { path: '/articles', changefreq: 'hourly', priority: '0.9' },
    { path: '/analysis', changefreq: 'hourly', priority: '0.8' },
    { path: '/topics', changefreq: 'daily', priority: '0.8' },
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
    <loc>${SITE.url}/article/${article.id}</loc>
    <lastmod>${article.data.date.toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('')}
  ${[...signalIndex.keys()]
    .map(
      (slug) => `
  <url>
    <loc>${SITE.url}/signals/${slug}</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`
    )
    .join('')}
  ${[...hierarchy.entries()]
    .flatMap(([topic, subcategories]) => {
      const tSlug = topicSlug(topic);
      return [
        `
  <url>
    <loc>${SITE.url}/topics/${tSlug}</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`,
        ...[...subcategories].map(
          (sub) => `
  <url>
    <loc>${SITE.url}/topics/${tSlug}/${subcategorySlug(sub)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`
        ),
      ];
    })
    .join('')}
  ${[...sourceIndex.keys()]
    .map(
      (domain) => `
  <url>
    <loc>${SITE.url}/sources/${domain}</loc>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
  </url>`
    )
    .join('')}
  ${[...authors]
    .map(
      (author) => `
  <url>
    <loc>${SITE.url}/author/${author}</loc>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
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
