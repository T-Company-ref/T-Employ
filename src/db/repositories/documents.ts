import { withTransaction } from '../client.js';
import type { StoredFile } from '../storage.js';

export interface DocumentInput {
  candidateId: string;
  applicationId?: string | null;
  talentPoolId?: string | null;
  docType?: 'resume' | 'cover_letter' | 'portfolio' | 'other';
  file: StoredFile;
  parsedText?: string | null;
}

async function insertDocument(
  client: {
    query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  },
  doc: DocumentInput,
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO candidate_documents
       (candidate_id, application_id, talent_pool_id, doc_type, file_url, file_hash, parsed_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      doc.candidateId,
      doc.applicationId ?? null,
      doc.talentPoolId ?? null,
      doc.docType ?? 'resume',
      doc.file.fileUrl,
      doc.file.fileHash,
      doc.parsedText ?? null,
    ],
  );
  return res.rows[0].id;
}

/** 동일 해시가 있으면 링크만 보강. 없으면 해당 대상 행을 in-place 갱신하거나 삽입. */
async function upsertOrReplaceLinked(
  doc: DocumentInput,
  link: { applicationId?: string | null; talentPoolId?: string | null },
): Promise<string> {
  return withTransaction(async (client) => {
    const docType = doc.docType ?? 'resume';

    if (doc.file.fileHash) {
      const byHash = await client.query<{ id: string }>(
        `SELECT id FROM candidate_documents WHERE file_hash = $1 LIMIT 1`,
        [doc.file.fileHash],
      );
      if (byHash.rows[0]) {
        await client.query(
          `UPDATE candidate_documents
           SET candidate_id = $2,
               application_id = COALESCE($3, application_id),
               talent_pool_id = COALESCE($4, talent_pool_id),
               file_url = $5,
               parsed_text = COALESCE($6, parsed_text),
               collected_at = now()
           WHERE id = $1`,
          [
            byHash.rows[0].id,
            doc.candidateId,
            link.applicationId ?? null,
            link.talentPoolId ?? null,
            doc.file.fileUrl,
            doc.parsedText ?? null,
          ],
        );
        return byHash.rows[0].id;
      }
    }

    if (link.applicationId) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM candidate_documents
         WHERE application_id = $1 AND doc_type = $2
         ORDER BY collected_at DESC NULLS LAST
         LIMIT 1`,
        [link.applicationId, docType],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE candidate_documents
           SET candidate_id = $2,
               talent_pool_id = COALESCE($3, talent_pool_id),
               file_url = $4,
               file_hash = $5,
               parsed_text = COALESCE($6, parsed_text),
               collected_at = now()
           WHERE id = $1`,
          [
            existing.rows[0].id,
            doc.candidateId,
            link.talentPoolId ?? null,
            doc.file.fileUrl,
            doc.file.fileHash,
            doc.parsedText ?? null,
          ],
        );
        return existing.rows[0].id;
      }
    }

    if (link.talentPoolId) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM candidate_documents
         WHERE talent_pool_id = $1 AND doc_type = $2
         ORDER BY collected_at DESC NULLS LAST
         LIMIT 1`,
        [link.talentPoolId, docType],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE candidate_documents
           SET candidate_id = $2,
               application_id = COALESCE($3, application_id),
               file_url = $4,
               file_hash = $5,
               parsed_text = COALESCE($6, parsed_text),
               collected_at = now()
           WHERE id = $1`,
          [
            existing.rows[0].id,
            doc.candidateId,
            link.applicationId ?? null,
            doc.file.fileUrl,
            doc.file.fileHash,
            doc.parsedText ?? null,
          ],
        );
        return existing.rows[0].id;
      }
    }

    return insertDocument(client, { ...doc, docType });
  });
}

/** application_id 기준 이력서 PDF 교체 (재수집용) — 삭제 없이 in-place 갱신 */
export async function replaceApplicationResumeDocument(doc: DocumentInput): Promise<string> {
  if (!doc.applicationId) {
    return upsertCandidateDocument(doc);
  }
  return upsertOrReplaceLinked(doc, {
    applicationId: doc.applicationId,
    talentPoolId: doc.talentPoolId,
  });
}

/** talent_pool_id 기준 이력서 PDF 교체 (재수집용) — 삭제 없이 in-place 갱신 */
export async function replaceTalentResumeDocument(doc: DocumentInput): Promise<string> {
  if (!doc.talentPoolId) {
    return upsertCandidateDocument(doc);
  }
  return upsertOrReplaceLinked(doc, {
    applicationId: doc.applicationId,
    talentPoolId: doc.talentPoolId,
  });
}

/** 이력서 PDF 메타를 candidate_documents 에 upsert (해시 있으면 링크 보강) */
export async function upsertCandidateDocument(doc: DocumentInput): Promise<string> {
  return upsertOrReplaceLinked(doc, {
    applicationId: doc.applicationId,
    talentPoolId: doc.talentPoolId,
  });
}
