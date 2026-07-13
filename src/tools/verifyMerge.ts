import { query, closePool } from '../db/client.js';
import { upsertApplicants } from '../db/repositories/applicants.js';

const REF_A = 'verify-merge-a';
const REF_B = 'verify-merge-b';

/**
 * 동일 email 지원자가 단일 candidates 행으로 병합되는지 검증.
 * applications 는 external_ref 별로 2건 유지.
 */
async function main(): Promise<void> {
  const email = `merge-verify-${Date.now()}@tbell.local`;
  const appliedAt = new Date().toISOString();

  const r1 = await upsertApplicants([
    {
      platform: 'jobkorea',
      externalRef: REF_A,
      name: '병합검증 A',
      email,
      appliedAt,
    },
  ]);

  const r2 = await upsertApplicants([
    {
      platform: 'jobkorea',
      externalRef: REF_B,
      name: '병합검증 B',
      email,
      appliedAt,
    },
  ]);

  const cand = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM candidates
     WHERE lower(email) = lower($1) AND merged_into IS NULL`,
    [email],
  );
  const apps = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM applications
     WHERE platform = 'jobkorea' AND external_ref IN ($1, $2)`,
    [REF_A, REF_B],
  );

  const candidateCount = Number(cand.rows[0]?.count ?? 0);
  const applicationCount = Number(apps.rows[0]?.count ?? 0);
  const ok = candidateCount === 1 && applicationCount === 2;

  console.log('[dev:verify-merge] 결과:', {
    r1,
    r2,
    candidateCount,
    applicationCount,
    ok,
  });

  await query(`DELETE FROM applications WHERE external_ref IN ($1, $2)`, [REF_A, REF_B]);
  await query(`DELETE FROM candidates WHERE lower(email) = lower($1)`, [email]);

  if (!ok) {
    console.error('[dev:verify-merge] 실패 — email 병합 규칙 불일치');
    process.exitCode = 1;
  } else {
    console.log('[dev:verify-merge] ✓ email 기준 후보 병합 규칙 정상');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
