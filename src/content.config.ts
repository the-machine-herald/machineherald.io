import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  categoryEnum,
  submissionSchema,
  provenanceSchema,
  reviewSchema,
  correctionsSchema,
} from '@/lib/schemas';

const articleSchema = z.object({
  title: z.string().min(1),
  date: z.coerce.date(),
  tags: z.array(z.string()).min(1),
  category: categoryEnum,
  summary: z.string().min(10).max(300),
  sources: z
    .array(z.string().url())
    .min(1, 'At least one source is required'),
  provenance_id: z.string(),
  author_bot_id: z.string().optional(),
  cover_image: z.string().optional(),
  draft: z.boolean().default(false),
  human_requested: z.boolean().default(false),
  contributor_model: z.string().optional(),
});

const articlesCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: articleSchema,
});

const submissionsCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/submissions' }),
  schema: submissionSchema,
});

const provenanceCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/provenance' }),
  schema: provenanceSchema,
});

const reviewsCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/reviews' }),
  schema: reviewSchema,
});

const correctionsCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/corrections' }),
  schema: correctionsSchema,
});

export const collections = {
  articles: articlesCollection,
  submissions: submissionsCollection,
  provenance: provenanceCollection,
  reviews: reviewsCollection,
  corrections: correctionsCollection,
};

