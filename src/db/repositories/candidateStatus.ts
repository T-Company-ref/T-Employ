import { query } from '../client.js';
import { requireStaff } from './staff.js';

export type StatusCode =
  | 'applied'
  | 'screening_pass'
  | 'interviewing'
  | 'interview_scheduled'
  | 'interview_pass'
  | 'interview_fail'
  | 'interview_no_show'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'closed_lost'
  | 'employed_elsewhere'
  | 'blocked';

/** candidate_status_history ↔ applications.current_stage 매핑 */
const APP_STAGE_MAP: Partial<Record<StatusCode, string>> = {
  applied: 'applied',
  screening_pass: 'screening_pass',
  interviewing: 'interviewing',
  interview_scheduled: 'interviewing',
  interview_pass: 'interviewing',
  interview_fail: 'interview_rejected',
  interview_no_show: 'interviewing',
  offer: 'offer',
  hired: 'hired',
  rejected: 'interview_rejected',
  closed_lost: 'closed_lost',
  employed_elsewhere: 'employed_elsewhere',
  blocked: 'blocked',
};

/** 상태 변경 이력 기록 + (선택) application.current_stage 동기화 */
export async function recordStatusChange(params: {
  candidateId: string;
  applicationId?: string;
  statusCode: StatusCode;
  reason?: string;
  actorNickname: string;
  syncApplicationStage?: boolean;
}): Promise<void> {
  const staff = await requireStaff(params.actorNickname);

  await query(
    `INSERT INTO candidate_status_history
       (candidate_id, application_id, status_code, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.candidateId,
      params.applicationId ?? null,
      params.statusCode,
      params.reason ?? null,
      staff.id,
    ],
  );

  if (params.syncApplicationStage && params.applicationId) {
    const stage = APP_STAGE_MAP[params.statusCode];
    if (stage) {
      await query(
        `UPDATE applications SET current_stage = $2, updated_at = now() WHERE id = $1`,
        [params.applicationId, stage],
      );
    }
  }

  if (params.statusCode === 'blocked') {
    await query(
      `UPDATE candidates SET is_active = false, updated_at = now() WHERE id = $1`,
      [params.candidateId],
    );
    if (params.applicationId) {
      await query(
        `UPDATE applications SET is_active = false, current_stage = 'blocked', updated_at = now() WHERE id = $1`,
        [params.applicationId],
      );
    }
  }
}

/** 후보자 소프트 블락 (물리 삭제 금지) */
export async function blockCandidate(params: {
  candidateId: string;
  applicationId?: string;
  reason?: string;
  actorNickname: string;
}): Promise<void> {
  await recordStatusChange({
    candidateId: params.candidateId,
    applicationId: params.applicationId,
    statusCode: 'blocked',
    reason: params.reason,
    actorNickname: params.actorNickname,
    syncApplicationStage: true,
  });
}

/** 인재풀 후보 소프트 블락 */
export async function blockTalentPool(params: {
  talentPoolId: string;
  reason?: string;
  actorNickname: string;
}): Promise<void> {
  const staff = await requireStaff(params.actorNickname);
  const row = await query<{ candidate_id: string | null }>(
    `SELECT candidate_id FROM talent_pool_candidates WHERE id = $1`,
    [params.talentPoolId],
  );
  await query(
    `UPDATE talent_pool_candidates
     SET proposal_status = 'blocked', is_active = false, updated_at = now()
     WHERE id = $1`,
    [params.talentPoolId],
  );
  const candidateId = row.rows[0]?.candidate_id;
  if (candidateId) {
    await query(
      `INSERT INTO candidate_status_history (candidate_id, status_code, reason, changed_by)
       VALUES ($1, 'blocked', $2, $3)`,
      [candidateId, params.reason ?? 'talent_pool blocked', staff.id],
    );
  }
}

/** 상태 이력 조회 */
export async function listStatusHistory(candidateId: string) {
  const res = await query(
    `SELECT h.*, s.nickname AS actor_nickname
     FROM candidate_status_history h
     LEFT JOIN staff_profiles s ON s.id = h.changed_by
     WHERE h.candidate_id = $1
     ORDER BY h.changed_at DESC`,
    [candidateId],
  );
  return res.rows;
}
