import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execScript, closePool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = resolve(__dirname, '../../db/seed/seed.sql');

async function main(): Promise<void> {
  try {
    const sql = readFileSync(SEED_FILE, 'utf8');
    await execScript(sql);
    console.log('[seed] 시드 데이터 적용 완료');
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
