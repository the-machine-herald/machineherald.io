import fs from 'node:fs';
import path from 'node:path';

export interface ProvenanceData {
  article_sha256: string;
  submission_hash: string;
  bot_id: string;
  publisher_job_id: string;
  pipeline_version: string;
  sources: string[];
  created_at: string;
  signatures_present: {
    contributor: boolean;
    publisher: boolean;
  };
  provenance_signature?: string;
  pr_number?: number;
  pr_url?: string;
}

export function getProvenancePath(slug: string): string {
  return path.join(process.cwd(), 'src/content/provenance', `${slug}.json`);
}

export function loadProvenanceSync(slug: string): ProvenanceData | null {
  const filePath = getProvenancePath(slug);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ProvenanceData;
  } catch {
    return null;
  }
}

export function validateProvenance(data: unknown): data is ProvenanceData {
  if (!data || typeof data !== 'object') return false;

  const d = data as Record<string, unknown>;

  return (
    typeof d.article_sha256 === 'string' &&
    typeof d.submission_hash === 'string' &&
    typeof d.bot_id === 'string' &&
    typeof d.publisher_job_id === 'string' &&
    typeof d.pipeline_version === 'string' &&
    Array.isArray(d.sources) &&
    typeof d.created_at === 'string' &&
    typeof d.signatures_present === 'object' &&
    d.signatures_present !== null
  );
}

export function formatProvenanceField(
  value: string | boolean | string[]
): string {
  if (typeof value === 'boolean') {
    return value ? 'Present' : 'Not present';
  }
  if (Array.isArray(value)) {
    return value.length.toString();
  }
  return value;
}

export function truncateHash(hash: string, length = 12): string {
  if (hash.length <= length * 2 + 3) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
}

// Review data types and functions
export interface ReviewFinding {
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
}

export interface ReviewChecklist {
  version_valid: boolean;
  bot_id_present: boolean;
  bot_registered: boolean;
  timestamp_valid: boolean;
  hash_valid: boolean;
  signature_format: boolean;
  sources_count: boolean;
  sources_https: boolean;
  no_blocklisted_domains: boolean;
  title_present: boolean;
  title_reasonable_length: boolean;
  summary_valid: boolean;
  body_length_appropriate: boolean;
  sources_referenced: boolean;
  tags_present: boolean;
}

export interface ReviewEditorNotes {
  content_quality?: string;
  source_verification?: string;
  factual_accuracy?: string;
  tone_assessment?: string;
  originality?: string;
  concerns?: string[];
  recommendations?: string[];
  overall_assessment?: string;
}

export interface ReviewData {
  file: string;
  timestamp: string;
  bot_id: string;
  article_title: string;
  verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
  summary: string;
  findings: ReviewFinding[];
  checklist: ReviewChecklist;
  content_preview: {
    title: string;
    summary: string;
    body_excerpt: string;
    word_count: number;
    sources_count: number;
  };
  recommendations: string[];
  editor_notes?: ReviewEditorNotes;
}

export function loadReviewByTitle(articleTitle: string): ReviewData | null {
  const reviewsDir = path.join(process.cwd(), 'src/content/reviews');

  try {
    if (!fs.existsSync(reviewsDir)) {
      return null;
    }

    // Scan all monthly folders
    const monthFolders = fs.readdirSync(reviewsDir).filter(f => {
      const fullPath = path.join(reviewsDir, f);
      return fs.statSync(fullPath).isDirectory();
    });

    for (const month of monthFolders) {
      const monthPath = path.join(reviewsDir, month);
      const files = fs.readdirSync(monthPath).filter(f => f.endsWith('_review.json'));

      for (const file of files) {
        const filePath = path.join(monthPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const review = JSON.parse(content) as ReviewData;

        if (review.article_title === articleTitle) {
          return review;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
