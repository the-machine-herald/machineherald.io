#!/usr/bin/env tsx
/**
 * Gzip Source Snapshots Migration
 *
 * Walks every sources/<YYYY-MM>/<slug>/manifest.json, gzips each
 * referenced source-N.html into source-N.html.gz, updates the manifest's
 * `file` field, and recomputes `sha256` to be the hash of the uncompressed
 * content (so future verifiers can decompress and rehash to check).
 *
 * Why recompute sha256? An audit found ~30% of historical manifests carry
 * sha256 values that don't match the bytes on disk (root cause unclear,
 * pre-existing). Going forward sha256 must be deterministic relative to
 * the disk file, so we adopt the new convention now and recompute every
 * snapshot's hash from its actual bytes.
 *
 * Usage:
 *   npm run gzip:snapshots                # dry-run, prints summary
 *   npm run gzip:snapshots -- --apply     # write changes
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const SOURCES_DIR = path.join(process.cwd(), 'sources');
const APPLY = process.argv.includes('--apply');

interface ManifestEntry {
  url: string;
  file: string | null;
  status_code: number | null;
  content_type: string | null;
  content_length: number | null;
  sha256: string | null;
  [k: string]: unknown;
}

interface Manifest {
  sources: ManifestEntry[];
  [k: string]: unknown;
}

function findManifests(root: string): string[] {
  const out: string[] = [];
  for (const month of fs.readdirSync(root)) {
    const monthDir = path.join(root, month);
    if (!fs.statSync(monthDir).isDirectory()) continue;
    for (const slug of fs.readdirSync(monthDir)) {
      const slugDir = path.join(monthDir, slug);
      if (!fs.statSync(slugDir).isDirectory()) continue;
      const m = path.join(slugDir, 'manifest.json');
      if (fs.existsSync(m)) out.push(m);
    }
  }
  return out;
}

interface Stats {
  manifests: number;
  files_already_gz: number;
  files_gzipped: number;
  files_missing: number;
  bytes_before: number;
  bytes_after: number;
  manifests_updated: number;
}

function migrate(): Stats {
  const stats: Stats = {
    manifests: 0,
    files_already_gz: 0,
    files_gzipped: 0,
    files_missing: 0,
    bytes_before: 0,
    bytes_after: 0,
    manifests_updated: 0,
  };

  const manifests = findManifests(SOURCES_DIR);
  console.log(`Found ${manifests.length} manifests under ${SOURCES_DIR}`);

  for (const manifestPath of manifests) {
    stats.manifests++;
    const slugDir = path.dirname(manifestPath);
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as Manifest;
    let manifestChanged = false;

    for (const entry of manifest.sources) {
      if (entry.file === null) continue;
      if (entry.file.endsWith('.html.gz')) {
        stats.files_already_gz++;
        continue;
      }
      if (!entry.file.endsWith('.html')) {
        // Unexpected extension — skip silently
        continue;
      }
      const oldPath = path.join(slugDir, entry.file);
      if (!fs.existsSync(oldPath)) {
        stats.files_missing++;
        continue;
      }
      const bytes = fs.readFileSync(oldPath);
      const newSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const gz = zlib.gzipSync(bytes, { level: 9 });
      const newFile = `${entry.file}.gz`;
      const newPath = path.join(slugDir, newFile);

      stats.bytes_before += bytes.length;
      stats.bytes_after += gz.length;
      stats.files_gzipped++;

      if (APPLY) {
        fs.writeFileSync(newPath, gz);
        fs.unlinkSync(oldPath);
        entry.file = newFile;
        entry.sha256 = newSha256;
        entry.content_length = bytes.length;
        manifestChanged = true;
      }
    }

    if (manifestChanged) {
      stats.manifests_updated++;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  return stats;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function main() {
  console.log(APPLY ? '=== APPLY MODE — writing changes ===' : '=== DRY RUN — pass --apply to write ===');
  const s = migrate();
  const ratio = s.bytes_before > 0 ? (s.bytes_after / s.bytes_before) * 100 : 0;
  const saved = s.bytes_before - s.bytes_after;
  console.log('');
  console.log('=== Summary ===');
  console.log(`Manifests scanned:      ${s.manifests}`);
  console.log(`Files already .gz:      ${s.files_already_gz}`);
  console.log(`Files to gzip:          ${s.files_gzipped}`);
  console.log(`Files missing on disk:  ${s.files_missing}`);
  console.log(`Manifests updated:      ${s.manifests_updated}`);
  console.log(`Bytes before:           ${fmtBytes(s.bytes_before)}`);
  console.log(`Bytes after:            ${fmtBytes(s.bytes_after)} (${ratio.toFixed(1)}% of original)`);
  console.log(`Saved:                  ${fmtBytes(saved)}`);
  if (!APPLY) {
    console.log('');
    console.log('Re-run with --apply to write changes.');
  }
}

main();
