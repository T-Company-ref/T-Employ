import { query } from '../client.js';
import type { CrawlJob, CrawlJobType, Platform } from '../types.js';

/**
 * 비정상 종료로 running 상태에 남은 작업을 정리한다.
 */
export async function releaseStaleJobs(staleMinutes = 15): Promise<number> {
  const res = await query<{ id: string }>(
    `UPDATE crawl_jobs
     SET status = 'failed',
         finished_at = now(),
         result_json = jsonb_build_object('error', 'stale_job_released')
     WHERE status IN ('queued', 'running')
       AND started_at < now() - ($1::text || ' minutes')::interval
     RETURNING id`,
    [String(staleMinutes)],
  );
  return res.rowCount;
}

/**
 * 크롤 작업 생성. (job_type, platform) 당 queued/running 1건 제약이 있으므로
 * 이미 활성 작업이 있으면 null 을 반환한다.
 */
export async function createJob(params: {
  jobType: CrawlJobType;
  platform: Platform;
  requestedBy?: string;
  triggerType?: 'manual' | 'schedule';
}): Promise<CrawlJob | null> {
  await releaseStaleJobs();
  const res = await query<CrawlJob>(
    `INSERT INTO crawl_jobs (job_type, platform, requested_by, trigger_type, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', now())
     ON CONFLICT (job_type, platform) WHERE status IN ('queued','running')
     DO NOTHING
     RETURNING *`,
    [params.jobType, params.platform, params.requestedBy ?? 'scheduler', params.triggerType ?? 'schedule'],
  );
  return res.rows[0] ?? null;
}

export async function finishJob(
  id: string,
  status: 'succeeded' | 'failed' | 'canceled',
  payload: { stats?: Record<string, unknown>; result?: Record<string, unknown> } = {},
): Promise<void> {
  await query(
    `UPDATE crawl_jobs
     SET status = $2,
         stats = $3,
         result_json = $4,
         finished_at = now()
     WHERE id = $1`,
    [id, status, payload.stats ?? null, payload.result ?? null],
  );
}

export async function logJob(
  jobId: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
  step?: string,
): Promise<void> {
  await query(
    `INSERT INTO crawl_logs (job_id, level, step, message, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, level, step ?? null, message, meta ?? null],
  );
}

export async function recordFailure(params: {
  jobId: string;
  platform: Platform;
  step?: string;
  errorCode?: string;
  errorMessage?: string;
  screenshotUrl?: string;
}): Promise<void> {
  await query(
    `INSERT INTO crawl_failures (job_id, platform, step, error_code, error_message, screenshot_url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.jobId,
      params.platform,
      params.step ?? null,
      params.errorCode ?? null,
      params.errorMessage ?? null,
      params.screenshotUrl ?? null,
    ],
  );
}
