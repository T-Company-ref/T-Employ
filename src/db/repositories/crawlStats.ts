import { query } from '../client.js';

export interface CrawlSuccessRate {
  days: number;
  total: number;
  succeeded: number;
  failed: number;
  ratePercent: number;
  byPlatform: Array<{
    platform: string;
    total: number;
    succeeded: number;
    ratePercent: number;
  }>;
}

/** 최근 N일 스케줄 크롤 성공률 (Phase 2 모니터링) */
export async function getScheduledSuccessRate(days = 7): Promise<CrawlSuccessRate> {
  const overall = await query<{ total: string; succeeded: string; failed: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'succeeded')::text AS succeeded,
       COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
     FROM crawl_jobs
     WHERE trigger_type = 'schedule'
       AND finished_at IS NOT NULL
       AND created_at >= now() - make_interval(days => $1::int)`,
    [days],
  );

  const byPlatform = await query<{
    platform: string;
    total: string;
    succeeded: string;
  }>(
    `SELECT
       platform,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'succeeded')::text AS succeeded
     FROM crawl_jobs
     WHERE trigger_type = 'schedule'
       AND finished_at IS NOT NULL
       AND created_at >= now() - make_interval(days => $1::int)
     GROUP BY platform
     ORDER BY platform`,
    [days],
  );

  const total = Number(overall.rows[0]?.total ?? 0);
  const succeeded = Number(overall.rows[0]?.succeeded ?? 0);
  const failed = Number(overall.rows[0]?.failed ?? 0);
  const ratePercent = total > 0 ? Math.round((succeeded / total) * 1000) / 10 : 0;

  return {
    days,
    total,
    succeeded,
    failed,
    ratePercent,
    byPlatform: byPlatform.rows.map((r) => {
      const t = Number(r.total);
      const s = Number(r.succeeded);
      return {
        platform: r.platform,
        total: t,
        succeeded: s,
        ratePercent: t > 0 ? Math.round((s / t) * 1000) / 10 : 0,
      };
    }),
  };
}
