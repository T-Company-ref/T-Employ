import { query } from '../client.js';
import { requireStaff } from './staff.js';
import { recordStatusChange } from './candidateStatus.js';

export type InterviewResult = 'scheduled' | 'pass' | 'fail' | 'no_show' | 'canceled';
export type MeetingType = 'onsite' | 'online' | 'phone';

export interface InterviewEvent {
  id: string;
  candidate_id: string;
  application_id: string | null;
  interview_at: Date | null;
  interviewer: string | null;
  meeting_type: MeetingType;
  result: InterviewResult;
  hired_start_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** 면접 일정 등록 */
export async function scheduleInterview(params: {
  candidateId: string;
  applicationId?: string;
  interviewAt: string;
  interviewer?: string;
  meetingType?: MeetingType;
  note?: string;
  actorNickname: string;
}): Promise<InterviewEvent> {
  const staff = await requireStaff(params.actorNickname);
  const res = await query<InterviewEvent>(
    `INSERT INTO interview_events
       (candidate_id, application_id, interview_at, interviewer, meeting_type, result, note, created_by)
     VALUES ($1, $2, $3::timestamptz, $4, $5, 'scheduled', $6, $7)
     RETURNING *`,
    [
      params.candidateId,
      params.applicationId ?? null,
      params.interviewAt,
      params.interviewer ?? null,
      params.meetingType ?? 'onsite',
      params.note ?? null,
      staff.id,
    ],
  );

  await recordStatusChange({
    candidateId: params.candidateId,
    applicationId: params.applicationId,
    statusCode: 'interview_scheduled',
    reason: params.note,
    actorNickname: params.actorNickname,
    syncApplicationStage: true,
  });

  return res.rows[0];
}

/** 면접 결과 갱신 (pass/fail/no_show/canceled) — 입사일 포함 시 hired 처리 */
export async function updateInterviewResult(params: {
  interviewId: string;
  result: InterviewResult;
  hiredStartDate?: string;
  note?: string;
  actorNickname: string;
}): Promise<InterviewEvent> {
  await requireStaff(params.actorNickname);
  const res = await query<InterviewEvent>(
    `UPDATE interview_events SET
       result = $2,
       hired_start_date = COALESCE($3::date, hired_start_date),
       note = COALESCE($4, note),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [params.interviewId, params.result, params.hiredStartDate ?? null, params.note ?? null],
  );
  const event = res.rows[0];
  if (!event) throw new Error(`interview_not_found: ${params.interviewId}`);

  const statusMap: Partial<Record<InterviewResult, string>> = {
    pass: 'interview_pass',
    fail: 'interview_fail',
    no_show: 'interview_no_show',
    canceled: 'interviewing',
  };

  let statusCode = statusMap[params.result];
  if (params.result === 'pass' && params.hiredStartDate) {
    statusCode = 'hired';
  }

  if (statusCode) {
    await recordStatusChange({
      candidateId: event.candidate_id,
      applicationId: event.application_id ?? undefined,
      statusCode: statusCode as Parameters<typeof recordStatusChange>[0]['statusCode'],
      reason: params.note,
      actorNickname: params.actorNickname,
      syncApplicationStage: true,
    });
  }

  return event;
}

/** 후보자 면접 목록 */
export async function listInterviewsForCandidate(candidateId: string): Promise<InterviewEvent[]> {
  const res = await query<InterviewEvent>(
    `SELECT * FROM interview_events
     WHERE candidate_id = $1
     ORDER BY interview_at DESC NULLS LAST`,
    [candidateId],
  );
  return res.rows;
}
