import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { env } from '../config/env.js';

/**
 * 임베디드(PGlite) DB 지속성 유틸.
 *
 * GitHub Actions 러너는 매 실행마다 초기화되므로, 라이브 데이터 디렉토리(data/pgdata)를
 * 단일 압축 스냅샷(data/pgdata.tar.gz)으로 덤프해 레포에 커밋한다.
 * 다음 실행은 스냅샷을 복원한 뒤 이어서 작업한다.
 *
 * hosted Postgres(DATABASE_URL=postgres://) 모드에서는 스킵한다.
 */

const SNAPSHOT = resolve(process.cwd(), 'data/pgdata.tar.gz');

function liveDir(): string {
  return resolve(process.cwd(), env.dataDir());
}

/** 라이브 DB → 스냅샷 파일 */
async function dump(): Promise<void> {
  if (env.dbDriver() === 'pg') {
    console.log('[persist] hosted Postgres 모드 — 덤프 스킵');
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

/** 스냅샷 파일 → 라이브 DB 디렉토리 */
async function restore(): Promise<void> {
  if (env.dbDriver() === 'pg') {
    console.log('[persist] hosted Postgres 모드 — 복원 스킵');
    return;
  }
  if (!existsSync(SNAPSHOT)) {
    console.log('[persist] 스냅샷 없음 — 신규 DB 로 시작 (migrate 필요)');
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
  console.log(`[persist] 스냅샷 복원 완료 → ${dir}`);
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
