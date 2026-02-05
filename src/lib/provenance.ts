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
  return path.join(process.cwd(), 'provenance', `${slug}.json`);
}

export async function loadProvenance(
  slug: string
): Promise<ProvenanceData | null> {
  const filePath = getProvenancePath(slug);

  try {
    if (typeof window !== 'undefined') {
      // Client-side: fetch from static file
      const response = await fetch(`/provenance/${slug}.json`);
      if (!response.ok) return null;
      return response.json();
    }

    // Server-side: read from filesystem
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ProvenanceData;
  } catch {
    return null;
  }
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
