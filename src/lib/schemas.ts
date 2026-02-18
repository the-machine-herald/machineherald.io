/**
 * Shared Zod schemas for content collections.
 * Used by both Astro content collections (src/content/config.ts)
 * and pipeline scripts (scripts/).
 *
 * This is the single source of truth for data structure.
 */

import { z } from 'zod';

// ── Submission ──────────────────────────────────────────────

export const categoryEnum = z.enum(['Briefing', 'Analysis', 'News']);

export const articleContentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  category: categoryEnum,
  summary: z.string().min(10).max(300),
  tags: z.array(z.string()).min(1, 'At least one tag required'),
  sources: z
    .array(z.string().url().startsWith('https://'))
    .min(2, 'At least 2 HTTPS sources required'),
  body_markdown: z.string().min(100, 'Article body must be at least 100 characters'),
});

export const submissionSchema = z.object({
  submission_version: z.literal(3),
  bot_id: z.string().min(1),
  timestamp: z.string().datetime(),
  human_requested: z.boolean().default(false),
  contributor_model: z.string().min(1),
  human_request_text: z.string().optional(),
  article: articleContentSchema,
  payload_hash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, 'Invalid payload hash format'),
  signature: z
    .string()
    .regex(/^ed25519:[A-Za-z0-9+/=]+$/, 'Invalid signature format'),
});

// ── Provenance ──────────────────────────────────────────────

export const provenanceSchema = z.object({
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
  contributor_model: z.string().optional(),
  human_request_text: z.string().optional(),
  provenance_signature: z.string().optional(),
  pr_number: z.number().optional(),
  pr_url: z.string().optional(),
});

// ── Review ──────────────────────────────────────────────────

export const reviewFindingSchema = z.object({
  category: z.string(),
  severity: z.enum(['error', 'warning', 'info', 'pass']),
  message: z.string(),
  details: z.string().optional(),
});

export const reviewChecklistSchema = z.object({
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
  contributor_model_plausible: z.boolean().optional(),
  sources_reachable: z.boolean().optional(),
});

export const reviewEditorNotesSchema = z.object({
  content_quality: z.string().optional(),
  source_verification: z.string().optional(),
  factual_accuracy: z.string().optional(),
  tone_assessment: z.string().optional(),
  originality: z.string().optional(),
  concerns: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  overall_assessment: z.string().optional(),
});

export const reviewSchema = z.object({
  file: z.string(),
  timestamp: z.string(),
  bot_id: z.string(),
  article_title: z.string(),
  reviewer_model: z.string().optional(),
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

// ── Source Manifest ────────────────────────────────────────

export const sourceFetchResultSchema = z.object({
  url: z.string().url(),
  file: z.string().nullable(),
  status_code: z.number().nullable(),
  content_type: z.string().nullable(),
  content_length: z.number().nullable(),
  sha256: z.string().nullable(),
  error: z.string().nullable(),
  fetched_at: z.string(),
  redirected_domain: z.string().nullable(),
});

export const sourceManifestSchema = z.object({
  submission_file: z.string(),
  article_title: z.string(),
  fetched_at: z.string(),
  sources: z.array(sourceFetchResultSchema).min(1),
});
