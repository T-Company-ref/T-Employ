import { query, closePool } from '../db/client.js';
import { addCandidateTag } from '../db/repositories/tags.js';
import { scheduleInterview, updateInterviewResult } from '../db/repositories/interviews.js';
import { listStatusHistory } from '../db/repositories/candidateStatus.js';

const ACTOR = 'admin';

/** Phase 3 협업 기능 스모크 검증 (태그·면접·상태·감사 추적) */
async function main(): Promise<void> {
  const cand = await query<{ id: string }>(
    `INSERT INTO candidates (name, email, source_type)
     VALUES ('Phase3 검증', $1, 'applicant')
     RETURNING id`,
    [`phase3-${Date.now()}@tbell.local`],
  );
  const candidateId = cand.rows[0].id;

  const app = await query<{ id: string }>(
    `INSERT INTO applications (candidate_id, platform, applied_at, external_ref)
     VALUES ($1, 'jobkorea', now(), $2)
     RETURNING id`,
    [candidateId, `phase3-app-${Date.now()}`],
  );
  const applicationId = app.rows[0].id;

  const tag = await addCandidateTag({
    targetType: 'applicant',
    targetId: applicationId,
    tagType: 'recommend',
    comment: 'phase3 verify',
    actorNickname: ACTOR,
  });

  const interview = await scheduleInterview({
    candidateId,
    applicationId,
    interviewAt: new Date(Date.now() + 86_400_000).toISOString(),
    interviewer: '검증담당',
    actorNickname: ACTOR,
  });

  await updateInterviewResult({
    interviewId: interview.id,
    result: 'pass',
    actorNickname: ACTOR,
    note: 'phase3 pass',
  });

  const audit = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tag_audit_logs WHERE tag_id = $1`,
    [tag.id],
  );
  const history = await listStatusHistory(candidateId);

  const ok =
    Number(audit.rows[0]?.count ?? 0) >= 1 &&
    history.length >= 2 &&
    history.every((h) => h.changed_by != null);

  console.log('[dev:collab-check]', {
    tagId: tag.id,
    interviewId: interview.id,
    auditLogs: audit.rows[0]?.count,
    statusHistory: history.length,
    ok,
  });

  await query(`DELETE FROM tag_audit_logs WHERE tag_id = $1`, [tag.id]);
  await query(`DELETE FROM candidate_tags WHERE id = $1`, [tag.id]);
  await query(`DELETE FROM interview_events WHERE candidate_id = $1`, [candidateId]);
  await query(`DELETE FROM candidate_status_history WHERE candidate_id = $1`, [candidateId]);
  await query(`DELETE FROM applications WHERE id = $1`, [applicationId]);
  await query(`DELETE FROM candidates WHERE id = $1`, [candidateId]);

  if (!ok) {
    console.error('[dev:collab-check] 실패');
    process.exitCode = 1;
  } else {
    console.log('[dev:collab-check] ✓ 태그/면접/상태·작성자 추적 정상');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
