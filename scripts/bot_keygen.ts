#!/usr/bin/env tsx
/**
 * Bot Key Generator
 *
 * Generates Ed25519 keypairs for contributor bots.
 * Private key is saved locally, public key is for registration.
 *
 * Usage:
 *   tsx scripts/bot_keygen.ts --bot-id <id>
 *   tsx scripts/bot_keygen.ts --bot-id <id> --force
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KEYS_DIR = path.join(process.cwd(), 'config/keys');

function generateKeypair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
  });

  return {
    privateKey: privateKey.toString('base64'),
    publicKey: publicKey.toString('base64'),
  };
}

function main() {
  const args = process.argv.slice(2);

  let botId: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--bot-id' && args[i + 1]) {
      botId = args[++i];
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--help') {
      console.log(`
Bot Key Generator - Generate Ed25519 keypairs for bots

Usage:
  tsx scripts/bot_keygen.ts --bot-id <id>
  tsx scripts/bot_keygen.ts --bot-id <id> --force

Options:
  --bot-id <id>   Bot identifier (required, min 16 characters)
  --force         Overwrite existing keys

Output:
  config/keys/<bot_id>.key  - Private key (keep secret!)
  config/keys/<bot_id>.pub  - Public key (register this)
`);
      process.exit(0);
    }
  }

  if (!botId) {
    console.error('Error: --bot-id is required');
    process.exit(1);
  }

  if (botId.length < 16) {
    console.error('Error: bot-id must be at least 16 characters');
    console.error(`  Got: "${botId}" (${botId.length} characters)`);
    process.exit(1);
  }

  // Ensure keys directory exists
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  const privateKeyPath = path.join(KEYS_DIR, `${botId}.key`);
  const publicKeyPath = path.join(KEYS_DIR, `${botId}.pub`);

  // Check for existing keys
  if (!force && (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath))) {
    console.error(`Error: Keys already exist for bot "${botId}"`);
    console.error('Use --force to overwrite');
    process.exit(1);
  }

  // Generate keys
  console.log(`\n🔐 Generating Ed25519 keypair for bot: ${botId}\n`);

  const { privateKey, publicKey } = generateKeypair();

  // Save keys
  fs.writeFileSync(privateKeyPath, privateKey);
  fs.writeFileSync(publicKeyPath, publicKey);

  // Set restrictive permissions on private key (Unix only)
  try {
    fs.chmodSync(privateKeyPath, 0o600);
  } catch {
    // Windows doesn't support chmod
  }

  console.log('✅ Keypair generated successfully!\n');
  console.log('Files created:');
  console.log(`  Private key: ${privateKeyPath}`);
  console.log(`  Public key:  ${publicKeyPath}`);
  console.log('');
  console.log('⚠️  IMPORTANT:');
  console.log('  - Keep the private key (.key) secret!');
  console.log('  - Add .key files to .gitignore');
  console.log('  - The public key (.pub) should be committed for verification');
  console.log('');
  console.log('Public key (for reference):');
  console.log(`  ${publicKey}`);
}

main();
