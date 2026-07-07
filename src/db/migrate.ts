import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function appliedIds(): Promise<Set<string>> {
  const res = await getPool().query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(res.rows.map((r) => r.id));
}

async function up(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedIds();
  const files = listMigrationFiles();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[migrate] 적용할 마이그레이션이 없습니다.');
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] 적용 완료: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] 실패: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
}

async function status(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedIds();
  const files = listMigrationFiles();
  console.log('[migrate] 상태:');
  for (const file of files) {
    console.log(`  ${applied.has(file) ? '[x]' : '[ ]'} ${file}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') await up();
    else if (cmd === 'status') await status();
    else {
      console.error(`알 수 없는 명령: ${cmd} (up | status)`);
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
