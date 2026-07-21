import { query } from '../client.js';
import type { Platform } from '../types.js';

export interface PlatformConfig {
  platform: Platform;
  enabled: boolean;
  priority: number;
  crawl_window: string | null;
  rate_limit: number;
  timeout_ms: number;
  max_retries: number;
  route_version: string | null;
}

/** 활성 플랫폼을 우선순위(priority ASC) 순서로 반환 */
export async function getEnabledPlatforms(): Promise<PlatformConfig[]> {
  const res = await query<PlatformConfig>(
    `SELECT platform, enabled, priority, crawl_window, rate_limit, timeout_ms, max_retries, route_version
     FROM platform_configs
     WHERE enabled = true
     ORDER BY priority ASC`,
  );
  return res.rows;
}

export async function recordHealth(
  platform: Platform,
  ok: boolean,
  lastError?: string,
): Promise<void> {
  await query(
    `INSERT INTO platform_health (platform, status, last_ok_at, last_error, fail_count_24h)
     VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, $4, CASE WHEN $3 THEN 0 ELSE 1 END)
     ON CONFLICT (platform) DO UPDATE SET
       status = $2,
       last_ok_at = CASE WHEN $3 THEN now() ELSE platform_health.last_ok_at END,
       last_error = $4,
       fail_count_24h = CASE WHEN $3 THEN 0 ELSE platform_health.fail_count_24h + 1 END`,
    [platform, ok ? 'ok' : 'fail', ok, lastError ?? null],
  );
}

export type PlatformHealthRow = {
  platform: string;
  status: string | null;
  last_ok_at: Date | string | null;
  last_error: string | null;
  fail_count_24h: number | null;
};

export async function getPlatformHealth(platform: Platform): Promise<PlatformHealthRow | null> {
  const res = await query<PlatformHealthRow>(
    `SELECT platform, status, last_ok_at, last_error, fail_count_24h
     FROM platform_health WHERE platform = $1`,
    [platform],
  );
  return res.rows[0] ?? null;
}

/** 지원자 크롤/폴링 마지막 성공 시각 */
export async function getLastApplicantsSuccessAt(): Promise<Date | null> {
  const res = await query<{ finished_at: Date | string | null }>(
    `SELECT finished_at
     FROM crawl_jobs
     WHERE job_type = 'applicants' AND status = 'succeeded' AND finished_at IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 1`,
  );
  const v = res.rows[0]?.finished_at;
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}
