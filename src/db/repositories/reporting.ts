import { query } from '../client.js';

export interface DailyReport {
  date: string;
  newApplicants: number;
  newTalents: number;
  interviewsToday: number;
  statusChanges: number;
  recommendationsAdded: number;
  byPlatform: { platform: string; applicants: number; talents: number }[];
}

/**
 * 전일(00:00~23:59 KST) 기준 요약 데이터를 집계한다.
 * KST 기준을 위해 timezone 'Asia/Seoul' 로 변환하여 계산.
 */
export async function buildDailyReport(targetDate?: string): Promise<DailyReport> {
  // targetDate 미지정 시 어제(KST)
  const dateExpr = targetDate
    ? `DATE '${targetDate}'`
    : `((now() AT TIME ZONE 'Asia/Seoul')::date - 1)`;

  const applicants = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM applications
     WHERE (applied_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}`,
  );

  const talents = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM talent_pool_candidates
     WHERE (sourced_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}`,
  );

  const interviews = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM interview_events
     WHERE (interview_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}`,
  );

  const statusChanges = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM candidate_status_history
     WHERE (changed_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}`,
  );

  const recs = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM candidate_tags
     WHERE tag_type = 'recommend'
       AND (tagged_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}`,
  );

  const byPlatform = await query<{ platform: string; applicants: string; talents: string }>(
    `SELECT p.platform,
            coalesce(a.cnt, 0)::text AS applicants,
            coalesce(t.cnt, 0)::text AS talents
     FROM platform_configs p
     LEFT JOIN (
       SELECT platform, count(*) AS cnt FROM applications
       WHERE (applied_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}
       GROUP BY platform
     ) a ON a.platform = p.platform
     LEFT JOIN (
       SELECT platform, count(*) AS cnt FROM talent_pool_candidates
       WHERE (sourced_at AT TIME ZONE 'Asia/Seoul')::date = ${dateExpr}
       GROUP BY platform
     ) t ON t.platform = p.platform
     ORDER BY p.priority ASC`,
  );

  const dateRow = await query<{ d: string }>(`SELECT (${dateExpr})::text AS d`);

  return {
    date: dateRow.rows[0].d,
    newApplicants: Number(applicants.rows[0].count),
    newTalents: Number(talents.rows[0].count),
    interviewsToday: Number(interviews.rows[0].count),
    statusChanges: Number(statusChanges.rows[0].count),
    recommendationsAdded: Number(recs.rows[0].count),
    byPlatform: byPlatform.rows.map((r) => ({
      platform: r.platform,
      applicants: Number(r.applicants),
      talents: Number(r.talents),
    })),
  };
}
