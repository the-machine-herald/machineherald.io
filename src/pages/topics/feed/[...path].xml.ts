import rss from '@astrojs/rss';
import type { APIContext, GetStaticPaths } from 'astro';
import {
  getArticlesWithMeta,
  getArticlesByTopic,
  getTopicHierarchy,
  topicSlug,
  subcategorySlug,
  type TopicCategory,
} from '@/lib/article-meta';
import { SITE } from '@/lib/seo';

export const getStaticPaths: GetStaticPaths = async () => {
  const allWithMeta = await getArticlesWithMeta();
  const published = allWithMeta.filter((a) => !a.article.data.draft);
  const hierarchy = getTopicHierarchy(published);

  const paths: {
    params: { path: string };
    props: { topic: TopicCategory; subcategory?: string };
  }[] = [];

  for (const [topic, subcategories] of hierarchy) {
    // Topic feed
    paths.push({
      params: { path: topicSlug(topic) },
      props: { topic },
    });

    // Subcategory feeds
    for (const sub of subcategories) {
      paths.push({
        params: { path: `${topicSlug(topic)}/${subcategorySlug(sub)}` },
        props: { topic, subcategory: sub },
      });
    }
  }

  return paths;
};

export async function GET(context: APIContext) {
  const { topic, subcategory } = context.props as { topic: TopicCategory; subcategory?: string };

  const allWithMeta = await getArticlesWithMeta();
  const published = allWithMeta.filter((a) => !a.article.data.draft);

  let articles = getArticlesByTopic(published, topic);
  if (subcategory) {
    articles = articles.filter((a) => a.meta?.data.subcategory === subcategory);
  }

  // Sort by date descending
  articles.sort((a, b) => b.article.data.date.getTime() - a.article.data.date.getTime());

  const feedTitle = subcategory
    ? `${SITE.name} — ${topic} / ${subcategory}`
    : `${SITE.name} — ${topic}`;

  const feedDescription = subcategory
    ? `${subcategory} articles in ${topic} from ${SITE.name}.`
    : `${topic} articles from ${SITE.name}.`;

  return rss({
    title: feedTitle,
    description: feedDescription,
    site: context.site ?? SITE.url,
    items: articles.slice(0, 20).map(({ article }) => ({
      title: article.data.title,
      pubDate: article.data.date,
      description: article.data.summary,
      link: `/article/${article.id}`,
      categories: article.data.tags,
      customData: `<source>${article.data.sources.length} verified sources</source>`,
    })),
    customData: `<language>en-us</language>
<copyright>The Machine Herald. AI-generated content with verifiable provenance.</copyright>
<generator>Astro + Machine Herald Pipeline</generator>`,
  });
}
