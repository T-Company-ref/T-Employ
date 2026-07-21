import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { env } from '../config/env.js';

/**
 * 임베디드(PGlite) DB 지속성 유틸.
 *
 * GitHub Actions 러너는 매 실행마다 초기화되므로, 라이브 데이터 디렉토리(data/pgdata)를
 * 단일 압축 스냅샷(data/pgdata.tar.gz)으로 덤프해 db-snapshot 브랜치에 푸시한다.
 * Playwright storageState(.sessions/*.json)는 sessions-bundle.json 으로 함께 지속한다.
 *
 * hosted Postgres(DATABASE_URL=postgres://) 모드에서는 스킵한다.
 */

const SNAPSHOT = resolve(process.cwd(), 'data/pgdata.tar.gz');
const SESSION_BUNDLE = resolve(process.cwd(), 'data/sessions-bundle.json');
const SESSION_DIR = resolve(process.cwd(), '.sessions');

function liveDir(): string {
  return resolve(process.cwd(), env.dataDir());
}

function dumpSessionBundle(): void {
  if (!existsSync(SESSION_DIR)) return;
  const bundle: Record<string, string> = {};
  for (const name of readdirSync(SESSION_DIR)) {
    if (!name.endsWith('.json')) continue;
    bundle[name] = readFileSync(resolve(SESSION_DIR, name), 'utf8');
  }
  if (Object.keys(bundle).length === 0) return;
  mkdirSync(dirname(SESSION_BUNDLE), { recursive: true });
  writeFileSync(SESSION_BUNDLE, JSON.stringify(bundle), 'utf8');
  console.log(`[persist] 세션 번들 저장: ${SESSION_BUNDLE} (${Object.keys(bundle).length} files)`);
}

function restoreSessionBundle(): void {
  if (!existsSync(SESSION_BUNDLE)) {
    console.log('[persist] 세션 번들 없음 — 신규 로그인 필요할 수 있음');
    return;
  }
  const bundle = JSON.parse(readFileSync(SESSION_BUNDLE, 'utf8')) as Record<string, string>;
  mkdirSync(SESSION_DIR, { recursive: true });
  for (const [name, content] of Object.entries(bundle)) {
    writeFileSync(resolve(SESSION_DIR, name), content, 'utf8');
  }
  console.log(`[persist] 세션 번들 복원: ${Object.keys(bundle).length} files → .sessions/`);
}

/** 스냅샷 파일 → 라이브 DB 디렉토리 (+ 세션 번들은 항상) */
async function restore(): Promise<void> {
  if (env.dbDriver() === 'pg') {
    console.log('[persist] hosted Postgres 모드 — DB 복원 스킵, 세션 번들만 복원');
    restoreSessionBundle();
    return;
  }
  if (!existsSync(SNAPSHOT)) {
    console.log('[persist] 스냅샷 없음 — 신규 DB 로 시작 (migrate 필요)');
    restoreSessionBundle();
    return;
  }
  // 기존 라이브 디렉토리 제거 후 스냅샷에서 재구성
  const dir = liveDir();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const data = readFileSync(SNAPSHOT);
  const blob = new Blob([data], { type: 'application/gzip' });
  const pg = await PGlite.create({ dataDir: dir, loadDataDir: blob });
  await pg.close();
  restoreSessionBundle();
  console.log(`[persist] 스냅샷 복원 완료 → ${dir}`);
}

/** 라이브 DB → 스냅샷 파일 (세션 번들은 드라이버와 무관하게 항상) */
async function dump(): Promise<void> {
  dumpSessionBundle();
  if (env.dbDriver() === 'pg') {
    console.log('[persist] hosted Postgres 모드 — DB 덤프 스킵 (세션 번들만 저장)');
    return;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = await PGlite.create(liveDir());
  const blob = await pg.dumpDataDir('gzip');
  const buf = Buffer.from(await blob.arrayBuffer());
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, buf);
  await pg.close();
  console.log(`[persist] 스냅샷 저장: ${SNAPSHOT} (${buf.length} bytes)`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'dump') await dump();
  else if (cmd === 'restore') await restore();
  else {
    console.error('사용법: tsx src/db/persist.ts <dump|restore>');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
