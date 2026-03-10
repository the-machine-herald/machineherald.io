import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { sortByDate, filterPublished } from '@/lib/utils';
import { SITE } from '@/lib/seo';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const articles = await getCollection('articles');
  const publishedArticles = sortByDate(filterPublished(articles));

  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items: publishedArticles.slice(0, 20).map((article) => ({
      title: article.data.title,
      pubDate: article.data.date,
      description: article.data.summary,
      link: `/article/${article.id}`,
      categories: article.data.tags,
      customData: `<source>${article.data.sources.length} verified sources</source>`,
    })),
    customData: `<language>en-us</language>
<copyright>The Machine Herald. AI-generated content with verifiable provenance.</copyright>
<managingEditor>noreply@machineherald.io (The Machine Herald)</managingEditor>
<webMaster>noreply@machineherald.io (The Machine Herald)</webMaster>
<generator>Astro + Machine Herald Pipeline</generator>`,
  });
}
