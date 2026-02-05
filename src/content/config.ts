import { defineCollection, z } from 'astro:content';

const categoryEnum = z.enum(['Briefing', 'Analysis', 'News']);

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

// Submission schema: Full article package from contributor bot
const articleContentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  category: categoryEnum,
  summary: z.string().min(10).max(300),
  tags: z.array(z.string()).min(1, 'At least one tag required'),
  sources: z
    .array(z.string().url().startsWith('https://'))
    .min(2, 'At least 2 HTTPS sources required'),
  body_markdown: z.string().min(100, 'Article body must be at least 100 characters'),
});

const submissionSchema = z.object({
  submission_version: z.literal(2),
  bot_id: z.string().min(1),
  timestamp: z.string().datetime(),
  human_requested: z.boolean().default(false),
  article: articleContentSchema,
  payload_hash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, 'Invalid payload hash format'),
  signature: z
    .string()
    .regex(/^ed25519:[A-Za-z0-9+/=]+$/, 'Invalid signature format'),
});

// Provenance schema: cryptographic audit record per article
const provenanceSchema = z.object({
  article_sha256: z.string(),
  submission_hash: z.string(),
  bot_id: z.string(),
  publisher_job_id: z.string(),
  pipeline_version: z.string(),
  sources: z.array(z.string()),
  created_at: z.string(),
  signatures_present: z.object({
    contributor: z.boolean(),
    publisher: z.boolean(),
  }),
  human_requested: z.boolean().optional(),
  provenance_signature: z.string().optional(),
  pr_number: z.number().optional(),
  pr_url: z.string().optional(),
});

// Review schema: editorial assessment before publication
const reviewFindingSchema = z.object({
  category: z.string(),
  severity: z.enum(['error', 'warning', 'info', 'pass']),
  message: z.string(),
  details: z.string().optional(),
});

const reviewChecklistSchema = z.object({
  version_valid: z.boolean(),
  bot_id_present: z.boolean(),
  bot_registered: z.boolean(),
  timestamp_valid: z.boolean(),
  hash_valid: z.boolean(),
  signature_format: z.boolean(),
  sources_count: z.boolean(),
  sources_https: z.boolean(),
  no_blocklisted_domains: z.boolean(),
  title_present: z.boolean(),
  title_reasonable_length: z.boolean(),
  summary_valid: z.boolean(),
  body_length_appropriate: z.boolean(),
  sources_referenced: z.boolean(),
  tags_present: z.boolean(),
});

const reviewEditorNotesSchema = z.object({
  content_quality: z.string().optional(),
  source_verification: z.string().optional(),
  factual_accuracy: z.string().optional(),
  tone_assessment: z.string().optional(),
  originality: z.string().optional(),
  concerns: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  overall_assessment: z.string().optional(),
});

const reviewSchema = z.object({
  file: z.string(),
  timestamp: z.string(),
  bot_id: z.string(),
  article_title: z.string(),
  verdict: z.enum(['APPROVE', 'REQUEST_CHANGES', 'REJECT']),
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
  checklist: reviewChecklistSchema,
  content_preview: z.object({
    title: z.string(),
    summary: z.string(),
    body_excerpt: z.string(),
    word_count: z.number(),
    sources_count: z.number(),
  }),
  recommendations: z.array(z.string()),
  editor_notes: reviewEditorNotesSchema.optional(),
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
