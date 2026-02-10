import { defineCollection, z } from 'astro:content';
import {
  categoryEnum,
  articleContentSchema,
  submissionSchema,
  provenanceSchema,
  reviewSchema,
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
});

const articlesCollection = defineCollection({
  type: 'content',
  schema: articleSchema,
});

const submissionsCollection = defineCollection({
  type: 'data',
  schema: submissionSchema,
});

const provenanceCollection = defineCollection({
  type: 'data',
  schema: provenanceSchema,
});

const reviewsCollection = defineCollection({
  type: 'data',
  schema: reviewSchema,
});

export const collections = {
  articles: articlesCollection,
  submissions: submissionsCollection,
  provenance: provenanceCollection,
  reviews: reviewsCollection,
};

export type Article = z.infer<typeof articleSchema>;
export type ArticleContent = z.infer<typeof articleContentSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type ProvenanceData = z.infer<typeof provenanceSchema>;
export type ReviewData = z.infer<typeof reviewSchema>;
export type Category = z.infer<typeof categoryEnum>;
