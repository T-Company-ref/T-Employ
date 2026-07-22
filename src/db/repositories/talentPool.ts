import { withTransaction } from '../client.js';
import type { NormalizedTalent } from '../types.js';
import type { UpsertResult } from './applicants.js';
import { storeResumePdf } from '../storage.js';
import { upsertCandidateDocument } from './documents.js';
import { classifyTalentProfile } from '../../domain/jobCategories.js';

export interface TalentUpsertResult extends UpsertResult {
  resumesSaved: number;
}

/**
 * 정규화된 인재검색 후보를 저장한다. (platform, profile_ref) 기준 upsert.
 */
export async function upsertTalents(records: NormalizedTalent[]): Promise<TalentUpsertResult> {
  let inserted = 0;
  let updated = 0;
  let resumesSaved = 0;

  const pendingResumes: Array<{
    candidateId: string;
    talentId: string;
    platform: string;
    profileRef: string;
    pdf: Buffer;
  }> = [];

  await withTransaction(async (client) => {
    for (const rec of records) {
      let candidateId: string | null = null;

      if (rec.name) {
        const found = await client.query<{ id: string }>(
          `SELECT c.id
           FROM candidates c
           JOIN talent_pool_candidates t ON t.candidate_id = c.id
           WHERE t.platform = $1 AND t.profile_ref = $2
           LIMIT 1`,
          [rec.platform, rec.profileRef],
        );
        candidateId = found.rows[0]?.id ?? null;

        if (!candidateId) {
          const created = await client.query<{ id: string }>(
            `INSERT INTO candidates (name, source_type)
             VALUES ($1, 'talent_pool')
             RETURNING id`,
            [rec.name],
          );
          candidateId = created.rows[0].id;
        } else {
          await client.query(`UPDATE candidates SET name = COALESCE($2, name) WHERE id = $1`, [
            candidateId,
            rec.name,
          ]);
        }
      }

      const metaJson = JSON.stringify(rec.profileMeta ?? {});
      const category = classifyTalentProfile({
        headline: rec.headline,
        summaryText: rec.summaryText,
        searchCondition: rec.searchCondition,
        skills: rec.profileMeta?.skills,
        roles: rec.profileMeta?.roles,
        badges: rec.profileMeta?.badges,
      });

      const res = await client.query<{ id: string; is_new: boolean }>(
        `INSERT INTO talent_pool_candidates
           (platform, profile_ref, profile_url, headline, summary_text, search_condition, sourced_at, candidate_id, profile_meta, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (platform, profile_ref)
         DO UPDATE SET
           profile_url = EXCLUDED.profile_url,
           headline = EXCLUDED.headline,
           summary_text = EXCLUDED.summary_text,
           search_condition = EXCLUDED.search_condition,
           sourced_at = EXCLUDED.sourced_at,
           candidate_id = COALESCE(EXCLUDED.candidate_id, talent_pool_candidates.candidate_id),
           profile_meta = EXCLUDED.profile_meta,
           category = COALESCE(EXCLUDED.category, talent_pool_candidates.category)
         RETURNING id, (xmax = 0) AS is_new`,
        [
          rec.platform,
          rec.profileRef,
          rec.profileUrl ?? null,
          rec.headline ?? null,
          rec.summaryText ?? null,
          rec.searchCondition ?? null,
          rec.sourcedAt,
          candidateId,
          metaJson,
          category,
        ],
      );

      if (res.rows[0].is_new) inserted += 1;
      else updated += 1;

      if (rec.resumePdf && candidateId) {
        pendingResumes.push({
          candidateId,
          talentId: res.rows[0].id,
          platform: rec.platform,
          profileRef: rec.profileRef,
          pdf: rec.resumePdf,
        });
      }
    }
  });

  for (const item of pendingResumes) {
    try {
      const stored = await storeResumePdf({
        platform: item.platform,
        ref: item.profileRef,
        pdf: item.pdf,
      });
      await upsertCandidateDocument({
        candidateId: item.candidateId,
        talentPoolId: item.talentId,
        file: stored,
      });
      resumesSaved += 1;
    } catch (err) {
      console.warn(`[talentPool] resume save failed ${item.profileRef}:`, (err as Error).message);
    }
  }

  return { inserted, updated, resumesSaved, newItems: [] };
}
