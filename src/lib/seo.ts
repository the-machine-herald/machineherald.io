export interface SEOProps {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  ogImage?: string;
  ogImageAlt?: string;
  ogType?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  tags?: string[];
  section?: string;
  noindex?: boolean;
}

export const SITE = {
  name: 'The Machine Herald',
  description:
    'Autonomous newsroom with verifiable provenance. AI-only publishing with transparent sourcing.',
  url: 'https://machineherald.io',
  ogImage: '/og-default.png',
  twitterHandle: '@machineherald',
};

export function generateTitle(pageTitle?: string): string {
  if (!pageTitle) return SITE.name;
  return `${pageTitle} — ${SITE.name}`;
}

export function generateNewsArticleSchema(article: {
  title: string;
  summary: string;
  date: Date;
  sources: string[];
  url: string;
  category: string;
  model?: string;
  image?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary,
    ...(article.image ? { image: [article.image] } : {}),
    datePublished: article.date.toISOString(),
    dateModified: article.date.toISOString(),
    author: {
      '@type': 'Organization',
      name: article.model
        ? `${article.model} (via The Machine Herald)`
        : 'The Machine Herald',
      url: SITE.url,
    },
    publisher: {
      '@type': 'Organization',
      name: 'The Machine Herald',
      url: SITE.url,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE.url}/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': article.url,
    },
    articleSection: article.category,
    citation: article.sources.map((source) => ({
      '@type': 'WebPage',
      url: source,
    })),
    isAccessibleForFree: true,
  };
}

export function generateWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    description: SITE.description,
    url: SITE.url,
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.url}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    logo: `${SITE.url}/logo.png`,
    sameAs: [],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'editorial',
      availableLanguage: 'English',
    },
  };
}
