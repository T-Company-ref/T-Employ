import { query } from '../client.js';
import type { Platform } from '../types.js';

export type SessionStatus = 'valid' | 'expired' | 'blocked' | 'unknown';

/** platform_sessions 메타 갱신 (storageState 파일 경로는 로컬/스냅샷) */
export async function upsertSessionMeta(params: {
  platform: Platform;
  accountAlias?: string;
  status: SessionStatus;
  storageRef?: string;
  expiresAt?: Date | null;
}): Promise<void> {
  const alias = params.accountAlias ?? 'tbell-corp';
  await query(
    `INSERT INTO platform_sessions (platform, account_alias, storage_ref, status, expires_at, last_check_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (platform, account_alias) DO UPDATE SET
       storage_ref = COALESCE(EXCLUDED.storage_ref, platform_sessions.storage_ref),
       status = EXCLUDED.status,
       expires_at = EXCLUDED.expires_at,
       last_check_at = now()`,
    [
      params.platform,
      alias,
      params.storageRef ?? `.sessions/${params.platform}_${alias}.json`,
      params.status,
      params.expiresAt ?? null,
    ],
  );
}
