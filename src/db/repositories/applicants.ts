import { withTransaction } from '../client.js';
import type { NormalizedApplicant } from '../types.js';

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/**
 * 정규화된 지원자 목록을 저장한다.
 * - 후보자 병합 규칙: email(우선) → 없으면 신규 후보 생성
 * - 지원 이력은 (platform, external_ref) 기준 upsert
 */
export async function upsertApplicants(
  records: NormalizedApplicant[],
): Promise<UpsertResult> {
  let inserted = 0;
  let updated = 0;

  await withTransaction(async (client) => {
    for (const rec of records) {
      // 1) 후보자 확보 (email 기준 매칭, 없으면 생성)
      let candidateId: string | null = null;

      if (rec.email) {
        const found = await client.query<{ id: string }>(
          `SELECT id FROM candidates
           WHERE lower(email) = lower($1) AND merged_into IS NULL
           LIMIT 1`,
          [rec.email],
        );
        candidateId = found.rows[0]?.id ?? null;
      }

      if (!candidateId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO candidates (name, email, phone, source_type)
           VALUES ($1, $2, $3, 'applicant')
           RETURNING id`,
          [rec.name ?? null, rec.email ?? null, rec.phone ?? null],
        );
        candidateId = created.rows[0].id;
      }

      // 2) 공고 매칭 (있으면 연결)
      let postingId: string | null = null;
      if (rec.postingExternalId) {
        const posting = await client.query<{ id: string }>(
          `INSERT INTO job_postings (platform, external_posting_id, title)
           VALUES ($1, $2, $3)
           ON CONFLICT (platform, external_posting_id)
           DO UPDATE SET title = EXCLUDED.title
           RETURNING id`,
          [rec.platform, rec.postingExternalId, rec.postingTitle ?? '(제목 없음)'],
        );
        postingId = posting.rows[0].id;
      }

      // 3) 지원 이력 upsert
      const app = await client.query<{ id: string; is_new: boolean }>(
        `INSERT INTO applications
           (candidate_id, posting_id, platform, applied_at, current_stage, external_ref)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (platform, external_ref)
         DO UPDATE SET current_stage = EXCLUDED.current_stage
         RETURNING id, (xmax = 0) AS is_new`,
        [
          candidateId,
          postingId,
          rec.platform,
          rec.appliedAt,
          rec.stage ?? 'applied',
          rec.externalRef,
        ],
      );

      if (app.rows[0].is_new) inserted += 1;
      else updated += 1;
    }
  });

  return { inserted, updated };
}
