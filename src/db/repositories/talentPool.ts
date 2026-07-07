import { withTransaction } from '../client.js';
import type { NormalizedTalent } from '../types.js';
import type { UpsertResult } from './applicants.js';

/**
 * 정규화된 인재검색 후보를 저장한다. (platform, profile_ref) 기준 upsert.
 * 공고 지원자와 완전히 분리된 테이블(talent_pool_candidates)에 저장한다.
 */
export async function upsertTalents(
  records: NormalizedTalent[],
): Promise<UpsertResult> {
  let inserted = 0;
  let updated = 0;

  await withTransaction(async (client) => {
    for (const rec of records) {
      const res = await client.query<{ id: string; is_new: boolean }>(
        `INSERT INTO talent_pool_candidates
           (platform, profile_ref, profile_url, headline, summary_text, search_condition, sourced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (platform, profile_ref)
         DO UPDATE SET
           profile_url = EXCLUDED.profile_url,
           headline = EXCLUDED.headline,
           summary_text = EXCLUDED.summary_text,
           search_condition = EXCLUDED.search_condition
         RETURNING id, (xmax = 0) AS is_new`,
        [
          rec.platform,
          rec.profileRef,
          rec.profileUrl ?? null,
          rec.headline ?? null,
          rec.summaryText ?? null,
          rec.searchCondition ?? null,
          rec.sourcedAt,
        ],
      );

      if (res.rows[0].is_new) inserted += 1;
      else updated += 1;
    }
  });

  return { inserted, updated };
}
