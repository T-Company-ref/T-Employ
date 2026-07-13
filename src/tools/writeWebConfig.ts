/**
 * .env 의 SUPABASE_URL / SUPABASE_ANON_KEY 로 web/config.js 생성
 * usage: npx tsx src/tools/writeWebConfig.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';

function optional(key: string): string {
  return process.env[key] ?? '';
}

const url = optional('SUPABASE_URL');
const anon = optional('SUPABASE_ANON_KEY');

if (!url || !anon) {
  console.error('[write-web-config] SUPABASE_URL / SUPABASE_ANON_KEY 를 .env 에 넣으세요.');
  process.exit(1);
}

const body = `window.__TBELL_EMPLOY_CONFIG__ = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(anon)},
};
`;

const out = resolve(process.cwd(), 'web/config.js');
writeFileSync(out, body, 'utf8');
console.log(`[write-web-config] 작성: ${out}`);
console.log(`[write-web-config] url=${url}`);
void env;
