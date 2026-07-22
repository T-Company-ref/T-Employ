import { withTransaction } from '../client.js';
import type { NormalizedApplicant } from '../types.js';
import { storeResumePdf } from '../storage.js';
import { upsertCandidateDocument } from './documents.js';
import { classifyPostingTitle } from '../../domain/jobCategories.js';

export interface NewApplicantBrief {
  applicationId: string;
  name: string | null;
  postingTitle: string | null;
  platform: string;
  appliedAt: string | null;
  externalRef: string;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  resumesSaved?: number;
  newItems: NewApplicantBrief[];
}

/**
 * 정규화된 지원자 목록을 저장한다.
 */
export async function upsertApplicants(
  records: NormalizedApplicant[],
): Promise<UpsertResult> {
  let inserted = 0;
  let updated = 0;
  let resumesSaved = 0;
  const newItems: NewApplicantBrief[] = [];

  const pendingResumes: Array<{
    candidateId: string;
    applicationId: string;
    platform: string;
    externalRef: string;
    pdf: Buffer;
  }> = [];

  await withTransaction(async (client) => {
    for (const rec of records) {
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
      } else if (rec.name) {
        await client.query(`UPDATE candidates SET name = COALESCE($1, name) WHERE id = $2`, [
          rec.name,
          candidateId,
        ]);
      }

      let postingId: string | null = null;
      if (rec.postingExternalId) {
        const title = rec.postingTitle?.trim() || '(제목 없음)';
        const metaJson = JSON.stringify(rec.postingMeta ?? {});
        const sourceUrl = rec.postingMeta?.viewUrl ?? null;
        const category = classifyPostingTitle(title);
        const posting = await client.query<{ id: string }>(
          `INSERT INTO job_postings (platform, external_posting_id, title, source_url, meta, category)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (platform, external_posting_id)
           DO UPDATE SET
             title = CASE
               WHEN job_postings.title IN ('(제목 없음)', '') AND EXCLUDED.title NOT IN ('(제목 없음)', '')
                 THEN EXCLUDED.title
               WHEN EXCLUDED.title NOT IN ('(제목 없음)', '') THEN EXCLUDED.title
               ELSE job_postings.title
             END,
             source_url = COALESCE(EXCLUDED.source_url, job_postings.source_url),
             meta = EXCLUDED.meta,
             category = COALESCE(EXCLUDED.category, job_postings.category)
           RETURNING id`,
          [rec.platform, rec.postingExternalId, title, sourceUrl, metaJson, category],
        );
        postingId = posting.rows[0].id;
      }

      const profileJson = JSON.stringify(rec.profileMeta ?? {});

      const app = await client.query<{ id: string; is_new: boolean }>(
        `INSERT INTO applications
           (candidate_id, posting_id, platform, applied_at, current_stage, external_ref, profile_meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (platform, external_ref)
         DO UPDATE SET
           applied_at = EXCLUDED.applied_at,
           posting_id = COALESCE(EXCLUDED.posting_id, applications.posting_id),
           profile_meta = EXCLUDED.profile_meta
         RETURNING id, (xmax = 0) AS is_new`,
        [
          candidateId,
          postingId,
          rec.platform,
          rec.appliedAt,
          rec.stage ?? 'applied',
          rec.externalRef,
          profileJson,
        ],
      );

      if (app.rows[0].is_new) {
        inserted += 1;
        newItems.push({
          applicationId: app.rows[0].id,
          name: rec.name ?? null,
          postingTitle: rec.postingTitle ?? null,
          platform: rec.platform,
          appliedAt: rec.appliedAt ?? null,
          externalRef: rec.externalRef,
        });
      } else {
        updated += 1;
      }

      if (rec.resumePdf) {
        pendingResumes.push({
          candidateId,
          applicationId: app.rows[0].id,
          platform: rec.platform,
          externalRef: rec.externalRef,
          pdf: rec.resumePdf,
        });
      }
    }
  });

  for (const item of pendingResumes) {
    try {
      const stored = await storeResumePdf({
        platform: item.platform,
        ref: `applicant-${item.externalRef}`,
        pdf: item.pdf,
      });
      await upsertCandidateDocument({
        candidateId: item.candidateId,
        applicationId: item.applicationId,
        file: stored,
      });
      resumesSaved += 1;
    } catch (err) {
      console.warn(`[applicants] resume save failed ${item.externalRef}:`, (err as Error).message);
    }
  }

  return { inserted, updated, resumesSaved, newItems };
}
