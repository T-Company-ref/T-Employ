import { query } from '../client.js';
import type { TalentProfileMeta } from '../types.js';
import { isSeekingCandidateFromMeta } from '../../mail/talentSeeking.js';

export const TALENT_DIGEST_LIMIT = 5;

export type TalentAlertRow = {
  talentId: string;
  name: string | null;
  headline: string | null;
  summaryText: string | null;
  platform: string;
  profileRef: string;
  profileUrl: string | null;
  sourcedAt: string | null;
  genderAge?: string | null;
  careerText?: string | null;
  company?: string | null;
  roles?: string[];
  skills?: string[];
  badges?: string[];
  jobStatus?: string | null;
  pdfUrl?: string | null;
};

function mapRow(r: {
  id: string;
  name: string | null;
  headline: string | null;
  summary_text: string | null;
  platform: string;
  profile_ref: string;
  profile_url: string | null;
  sourced_at: string | null;
  profile_meta: TalentProfileMeta | null;
  pdf_url: string | null;
}): TalentAlertRow {
  const meta = r.profile_meta ?? {};
  return {
    talentId: r.id,
    name: r.name,
    headline: r.headline,
    summaryText: r.summary_text,
    platform: r.platform,
    profileRef: r.profile_ref,
    profileUrl: r.profile_url,
    sourcedAt: r.sourced_at,
    genderAge: meta.genderAge ?? null,
    careerText: meta.careerText ?? null,
    company: meta.company ?? null,
    roles: meta.roles ?? [],
    skills: meta.skills ?? [],
    badges: meta.badges ?? [],
    jobStatus: meta.jobStatus ?? null,
    pdfUrl: r.pdf_url && String(r.pdf_url).startsWith('http') ? r.pdf_url : null,
  };
}

export async function markTalentsAlerted(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  await query(
    `UPDATE talent_pool_candidates
     SET alerted_at = COALESCE(alerted_at, now())
     WHERE id = ANY($1::uuid[])`,
    [unique],
  );
}

/**
 * 모닝 인재 다이제스트 후보.
 * - 신규(또는 force 시 구간 내) · active · sourced
 * - 메타상 취업완료 제외
 * - 최대 limit명
 */
export async function listTalentsForDigest(params: {
  start: Date;
  end: Date;
  force?: boolean;
  limit?: number;
}): Promise<TalentAlertRow[]> {
  const limit = params.limit ?? TALENT_DIGEST_LIMIT;
  const res = await query<{
    id: string;
    name: string | null;
    headline: string | null;
    summary_text: string | null;
    platform: string;
    profile_ref: string;
    profile_url: string | null;
    sourced_at: string | null;
    profile_meta: TalentProfileMeta | null;
    pdf_url: string | null;
  }>(
    `SELECT t.id,
            c.name,
            t.headline,
            t.summary_text,
            t.platform,
            t.profile_ref,
            t.profile_url,
            t.sourced_at,
            t.profile_meta,
            (
              SELECT d.file_url
              FROM candidate_documents d
              WHERE d.talent_pool_id = t.id
                AND d.doc_type = 'resume'
              ORDER BY d.collected_at DESC NULLS LAST
              LIMIT 1
            ) AS pdf_url
     FROM talent_pool_candidates t
     LEFT JOIN candidates c ON c.id = t.candidate_id
     WHERE t.is_active = true
       AND t.proposal_status NOT IN ('blocked', 'declined')
       AND ($3::boolean OR t.alerted_at IS NULL)
       AND (
         (t.created_at >= $1 AND t.created_at < $2)
         OR ($3::boolean AND t.created_at >= now() - interval '14 days')
       )
     ORDER BY t.created_at DESC
     LIMIT 40`,
    [params.start.toISOString(), params.end.toISOString(), params.force === true],
  );

  const filtered = res.rows
    .map(mapRow)
    .filter((row) =>
      isSeekingCandidateFromMeta({
        jobStatus: row.jobStatus,
        badges: row.badges,
        careerText: row.careerText,
        headline: row.headline,
        summaryText: row.summaryText,
        company: row.company,
      }),
    )
    .slice(0, limit);

  return filtered;
}
