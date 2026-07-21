import { query } from '../client.js';
import type { ApplicantProfileMeta } from '../types.js';
import type { NewApplicantBrief } from './applicants.js';

export type ApplicantAlertRow = NewApplicantBrief & {
  applicationId: string;
  position?: string | null;
  genderAge?: string | null;
  careerTotal?: string | null;
  education?: string | null;
  desiredSalary?: string | null;
  recommendTags?: string[];
  careerHistory?: string[];
  pdfUrl?: string | null;
  detailUrl?: string | null;
  platformLabel?: string;
};

function mapRows(
  rows: Array<{
    id: string;
    name: string | null;
    posting_title: string | null;
    platform: string;
    applied_at: string | null;
    external_ref: string;
    profile_meta: ApplicantProfileMeta | null;
    pdf_url: string | null;
  }>,
): ApplicantAlertRow[] {
  return rows.map((r) => {
    const meta = r.profile_meta ?? {};
    const education = [meta.educationLevel, meta.educationSchool, meta.educationMajor]
      .filter(Boolean)
      .join(' · ');
    return {
      applicationId: r.id,
      name: r.name,
      postingTitle: r.posting_title,
      platform: r.platform,
      appliedAt: r.applied_at,
      externalRef: r.external_ref,
      position: meta.position ?? null,
      genderAge: meta.genderAge ?? ([meta.gender, meta.age].filter(Boolean).join(', ') || null),
      careerTotal: meta.careerTotal ?? null,
      education: education || null,
      desiredSalary: meta.desiredSalary ?? null,
      recommendTags: meta.recommendTags ?? [],
      careerHistory: meta.careerHistory ?? [],
      pdfUrl: r.pdf_url && String(r.pdf_url).startsWith('http') ? r.pdf_url : null,
      detailUrl: meta.detailUrl ?? null,
      platformLabel: r.platform === 'jobkorea' ? '잡코리아' : r.platform === 'saramin' ? '사람인' : r.platform,
    };
  });
}

export async function markApplicationsAlerted(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  await query(
    `UPDATE applications
     SET alerted_at = COALESCE(alerted_at, now())
     WHERE id = ANY($1::uuid[])`,
    [unique],
  );
}

/** 메일용으로 지원자 상세(공고·메타·PDF URL)를 로드 */
export async function loadApplicantAlertDetails(
  applicationIds: string[],
): Promise<ApplicantAlertRow[]> {
  const unique = [...new Set(applicationIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const res = await query<{
    id: string;
    name: string | null;
    posting_title: string | null;
    platform: string;
    applied_at: string | null;
    external_ref: string;
    profile_meta: ApplicantProfileMeta | null;
    pdf_url: string | null;
  }>(
    `SELECT a.id,
            c.name,
            p.title AS posting_title,
            a.platform,
            a.applied_at,
            a.external_ref,
            a.profile_meta,
            (
              SELECT d.file_url
              FROM candidate_documents d
              WHERE d.application_id = a.id
                AND d.doc_type = 'resume'
              ORDER BY d.collected_at DESC NULLS LAST
              LIMIT 1
            ) AS pdf_url
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN job_postings p ON p.id = a.posting_id
     WHERE a.id = ANY($1::uuid[])
     ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC`,
    [unique],
  );
  return mapRows(res.rows);
}

/**
 * 다이제스트 구간 미알림 지원자.
 * - 기본: created_at ∈ [start, end)
 * - weekend=true(월요일): 구간에 더해 미알림 주말 지원일(토·일)도 포함
 * - force=true: alerted_at 무시
 */
export async function listApplicantsInDigestWindow(params: {
  start: Date;
  end: Date;
  force?: boolean;
  includeUnalertedWeekendApplied?: boolean;
}): Promise<ApplicantAlertRow[]> {
  const res = await query<{
    id: string;
    name: string | null;
    posting_title: string | null;
    platform: string;
    applied_at: string | null;
    external_ref: string;
    profile_meta: ApplicantProfileMeta | null;
    pdf_url: string | null;
  }>(
    `SELECT a.id,
            c.name,
            p.title AS posting_title,
            a.platform,
            a.applied_at,
            a.external_ref,
            a.profile_meta,
            (
              SELECT d.file_url
              FROM candidate_documents d
              WHERE d.application_id = a.id
                AND d.doc_type = 'resume'
              ORDER BY d.collected_at DESC NULLS LAST
              LIMIT 1
            ) AS pdf_url
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN job_postings p ON p.id = a.posting_id
     WHERE ($3::boolean OR a.alerted_at IS NULL)
       AND (
         (a.created_at >= $1 AND a.created_at < $2)
         OR (
           $4::boolean
           AND a.applied_at IS NOT NULL
           AND a.applied_at >= $1
           AND EXTRACT(DOW FROM (a.applied_at AT TIME ZONE 'Asia/Seoul')) IN (0, 6)
         )
       )
     ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC`,
    [
      params.start.toISOString(),
      params.end.toISOString(),
      params.force === true,
      params.includeUnalertedWeekendApplied === true,
    ],
  );
  return mapRows(res.rows);
}

/**
 * 지원 시각(applied_at) 기준 구간 조회.
 * includeAlerted=true 이면 이미 알림 보낸 지원자도 포함 (오전 메일 근무시간 전체 목록용).
 */
export async function listApplicantsByAppliedRange(params: {
  start: Date;
  end: Date;
  includeAlerted?: boolean;
}): Promise<ApplicantAlertRow[]> {
  const res = await query<{
    id: string;
    name: string | null;
    posting_title: string | null;
    platform: string;
    applied_at: string | null;
    external_ref: string;
    profile_meta: ApplicantProfileMeta | null;
    pdf_url: string | null;
  }>(
    `SELECT a.id,
            c.name,
            p.title AS posting_title,
            a.platform,
            a.applied_at,
            a.external_ref,
            a.profile_meta,
            (
              SELECT d.file_url
              FROM candidate_documents d
              WHERE d.application_id = a.id
                AND d.doc_type = 'resume'
              ORDER BY d.collected_at DESC NULLS LAST
              LIMIT 1
            ) AS pdf_url
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN job_postings p ON p.id = a.posting_id
     WHERE a.applied_at IS NOT NULL
       AND a.applied_at >= $1
       AND a.applied_at < $2
       AND ($3::boolean OR a.alerted_at IS NULL)
     ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC`,
    [params.start.toISOString(), params.end.toISOString(), params.includeAlerted === true],
  );
  return mapRows(res.rows);
}
