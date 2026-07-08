import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { execScript, closePool } from './client.js';

/**
 * Supabase 전용 SQL(db/supabase/*.sql: RLS, auth 매핑)을 적용한다.
 * auth 스키마/auth.uid() 는 Supabase 에만 존재하므로 hosted pg 모드에서만 실행한다.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = resolve(__dirname, '../../db/supabase');

async function main(): Promise<void> {
  if (env.dbDriver() !== 'pg') {
    console.log('[supabase] DATABASE_URL 이 postgres:// 가 아니므로 스킵 (임베디드 모드에서는 불필요)');
    return;
  }
  if (!existsSync(SUPABASE_DIR)) {
    console.log('[supabase] db/supabase 디렉토리 없음 — 적용할 SQL 없음');
    return;
  }
  const files = readdirSync(SUPABASE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  try {
    for (const file of files) {
      const sql = readFileSync(resolve(SUPABASE_DIR, file), 'utf8');
      await execScript(sql);
      console.log(`[supabase] 적용 완료: ${file}`);
    }
    console.log('[supabase] RLS/auth 정책 적용 완료');
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
