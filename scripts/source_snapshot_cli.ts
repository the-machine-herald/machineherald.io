#!/usr/bin/env tsx
/**
 * Standalone CLI for source snapshot creation.
 *
 * Reads a submission JSON and fetches + archives all source URLs
 * into the sources/ directory without running a full editorial review.
 *
 * Usage: tsx scripts/source_snapshot_cli.ts <submission.json>
 */

import fs from 'node:fs';
import { fetchAndSnapshotSources } from './lib/source_snapshot';

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: tsx scripts/source_snapshot_cli.ts <submission.json>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const submission = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const sources: string[] = submission.article?.sources ?? [];

  if (sources.length === 0) {
    console.error('No sources found in submission.');
    process.exit(1);
  }

  const title: string = submission.article?.title ?? 'unknown';
  console.log(`Fetching ${sources.length} source(s) for "${title}"…\n`);

  const result = await fetchAndSnapshotSources(sources, filePath, title);

  for (const src of result.sources) {
    const icon = src.status_code !== null && src.status_code < 400 ? '✓' : '✗';
    const status = src.status_code ?? 'ERR';
    const extra = src.error ? ` (${src.error})` : '';
    console.log(`  ${icon} [${status}] ${src.url}${extra}`);
  }

  console.log(`\nManifest written to: ${result.manifestPath}`);
  console.log(`Snapshots directory:  ${result.snapshotDir}`);

  if (!result.allReachable) {
    const dead = result.sources.filter(
      (s) => s.status_code === null || s.status_code >= 400,
    ).length;
    console.log(`\n⚠ ${dead} source(s) could not be verified.`);
    process.exit(1);
  }

  console.log('\nAll sources reachable.');
}

main().catch((err) => {
  console.error('Unexpected error while creating source snapshots:');
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
