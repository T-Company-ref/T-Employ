import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { env } from '../config/env.js';

/**
 * DB 드라이버 추상화.
 * - 기본: PGlite(임베디드 Postgres, 파일 지속) — 계정/Docker 불필요
 * - DATABASE_URL 이 postgres:// 이면 node-postgres(Supabase/RDS 등)로 자동 전환
 * 두 드라이버 모두 $1 placeholder 와 { rows } 결과 형태를 공유한다.
 */

export interface QueryResultLike<T> {
  rows: T[];
}

/** 트랜잭션 내부에서 쓰는 최소 실행기 */
export interface QueryRunner {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

interface Db extends QueryRunner {
  exec(sql: string): Promise<void>;
  /** 멀티 스테이트먼트 SQL 스크립트를 단일 트랜잭션으로 실행 (마이그레이션용) */
  execScript(sql: string): Promise<void>;
  transaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
  dumpTarball(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

let dbPromise: Promise<Db> | null = null;

async function createPgDb(): Promise<Db> {
  const pgModule = await import('pg');
  const { Pool } = pgModule.default;
  const pool = new Pool({
    connectionString: env.databaseUrl(),
    ssl: env.pgSsl() ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as never[]);
      return { rows: res.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async execScript(sql: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async transaction<T>(fn: (tx: QueryRunner) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const runner: QueryRunner = {
          async query<R>(text: string, params?: unknown[]) {
            const res = await client.query(text, params as never[]);
            return { rows: res.rows as R[] };
          },
        };
        const result = await fn(runner);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async dumpTarball() {
      return null; // hosted DB 는 덤프 커밋 불필요
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = resolve(process.cwd(), env.dataDir());
  mkdirSync(dir, { recursive: true }); // PGlite nodefs 는 재귀 생성하지 않음
  const pg = await PGlite.create(dir);

  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await pg.query<T>(text, params as unknown[]);
      return { rows: res.rows };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async execScript(sql: string) {
      // PGlite 는 단일 커넥션이라 BEGIN/COMMIT 로 감싸 원자성 확보
      await pg.exec(`BEGIN;\n${sql}\n;COMMIT;`);
    },
    async transaction<T>(fn: (tx: QueryRunner) => Promise<T>) {
      return pg.transaction(async (tx) => {
        const runner: QueryRunner = {
          async query<R>(text: string, params?: unknown[]) {
            const res = await tx.query<R>(text, params as unknown[]);
            return { rows: res.rows };
          },
        };
        return fn(runner);
      }) as Promise<T>;
    },
    async dumpTarball() {
      const blob = await pg.dumpDataDir('gzip');
      const buf = await blob.arrayBuffer();
      return new Uint8Array(buf);
    },
    async close() {
      await pg.close();
    },
  };
}

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = env.dbDriver() === 'pg' ? createPgDb() : createPgliteDb();
  }
  return dbPromise;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResultLike<T>> {
  const db = await getDb();
  return db.query<T>(text, params);
}

export async function exec(sql: string): Promise<void> {
  const db = await getDb();
  return db.exec(sql);
}

export async function execScript(sql: string): Promise<void> {
  const db = await getDb();
  return db.execScript(sql);
}

export async function withTransaction<T>(
  fn: (tx: QueryRunner) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export async function closePool(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.close();
    dbPromise = null;
  }
}
