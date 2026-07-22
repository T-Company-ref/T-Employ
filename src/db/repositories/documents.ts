import { withTransaction } from '../client.js';
import type { StoredFile } from '../storage.js';

export type DocType = 'resume' | 'cover_letter' | 'portfolio' | 'other';

export interface DocumentInput {
  candidateId: string;
  applicationId?: string | null;
  talentPoolId?: string | null;
  docType?: DocType;
  file: StoredFile;
  parsedText?: string | null;
  sourceName?: string | null;
  sourceLabel?: string | null;
}

type TxClient = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

async function insertDocument(client: TxClient, doc: DocumentInput): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO candidate_documents
       (candidate_id, application_id, talent_pool_id, doc_type, file_url, file_hash, parsed_text, source_name, source_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      doc.candidateId,
      doc.applicationId ?? null,
      doc.talentPoolId ?? null,
      doc.docType ?? 'resume',
      doc.file.fileUrl,
      doc.file.fileHash,
      doc.parsedText ?? null,
      doc.sourceName ?? null,
      doc.sourceLabel ?? null,
    ],
  );
  return res.rows[0].id;
}

async function touchByHash(client: TxClient, doc: DocumentInput, link: {
  applicationId?: string | null;
  talentPoolId?: string | null;
}): Promise<string | null> {
  if (!doc.file.fileHash) return null;
  const byHash = await client.query<{ id: string }>(
    `SELECT id FROM candidate_documents WHERE file_hash = $1 LIMIT 1`,
    [doc.file.fileHash],
  );
  if (!byHash.rows[0]) return null;
  await client.query(
    `UPDATE candidate_documents
     SET candidate_id = $2,
         application_id = COALESCE($3, application_id),
         talent_pool_id = COALESCE($4, talent_pool_id),
         file_url = $5,
         parsed_text = COALESCE($6, parsed_text),
         source_name = COALESCE($7, source_name),
         source_label = COALESCE($8, source_label),
         collected_at = now()
     WHERE id = $1`,
    [
      byHash.rows[0].id,
      doc.candidateId,
      link.applicationId ?? null,
      link.talentPoolId ?? null,
      doc.file.fileUrl,
      doc.parsedText ?? null,
      doc.sourceName ?? null,
      doc.sourceLabel ?? null,
    ],
  );
  return byHash.rows[0].id;
}

/** 이력서 등 단일 문서: 해시/대상 기준 in-place 갱신 */
async function upsertOrReplaceLinked(
  doc: DocumentInput,
  link: { applicationId?: string | null; talentPoolId?: string | null },
): Promise<string> {
  return withTransaction(async (client) => {
    const docType = doc.docType ?? 'resume';
    const touched = await touchByHash(client, doc, link);
    if (touched) return touched;

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
               source_name = COALESCE($7, source_name),
               source_label = COALESCE($8, source_label),
               collected_at = now()
           WHERE id = $1`,
          [
            existing.rows[0].id,
            doc.candidateId,
            link.talentPoolId ?? null,
            doc.file.fileUrl,
            doc.file.fileHash,
            doc.parsedText ?? null,
            doc.sourceName ?? null,
            doc.sourceLabel ?? null,
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
               source_name = COALESCE($7, source_name),
               source_label = COALESCE($8, source_label),
               collected_at = now()
           WHERE id = $1`,
          [
            existing.rows[0].id,
            doc.candidateId,
            link.applicationId ?? null,
            doc.file.fileUrl,
            doc.file.fileHash,
            doc.parsedText ?? null,
            doc.sourceName ?? null,
            doc.sourceLabel ?? null,
          ],
        );
        return existing.rows[0].id;
      }
    }

    return insertDocument(client, { ...doc, docType });
  });
}

/**
 * 포트폴리오/첨부: 지원자당 여러 파일 허용.
 * 동일 (application_id, source_name) 또는 동일 해시면 갱신, 아니면 INSERT.
 */
export async function upsertApplicationAttachment(doc: DocumentInput): Promise<string> {
  if (!doc.applicationId) {
    return upsertCandidateDocument({ ...doc, docType: doc.docType ?? 'portfolio' });
  }
  return withTransaction(async (client) => {
    const docType = doc.docType ?? 'portfolio';
    const touched = await touchByHash(client, { ...doc, docType }, {
      applicationId: doc.applicationId,
      talentPoolId: doc.talentPoolId,
    });
    if (touched) return touched;

    if (doc.sourceName) {
      const byName = await client.query<{ id: string }>(
        `SELECT id FROM candidate_documents
         WHERE application_id = $1 AND doc_type = $2 AND source_name = $3
         LIMIT 1`,
        [doc.applicationId, docType, doc.sourceName],
      );
      if (byName.rows[0]) {
        await client.query(
          `UPDATE candidate_documents
           SET candidate_id = $2,
               file_url = $3,
               file_hash = $4,
               source_label = COALESCE($5, source_label),
               collected_at = now()
           WHERE id = $1`,
          [
            byName.rows[0].id,
            doc.candidateId,
            doc.file.fileUrl,
            doc.file.fileHash,
            doc.sourceLabel ?? null,
          ],
        );
        return byName.rows[0].id;
      }
    }

    return insertDocument(client, { ...doc, docType });
  });
}

export async function replaceApplicationResumeDocument(doc: DocumentInput): Promise<string> {
  if (!doc.applicationId) return upsertCandidateDocument(doc);
  return upsertOrReplaceLinked(
    { ...doc, docType: 'resume' },
    { applicationId: doc.applicationId, talentPoolId: doc.talentPoolId },
  );
}

export async function replaceTalentResumeDocument(doc: DocumentInput): Promise<string> {
  if (!doc.talentPoolId) return upsertCandidateDocument(doc);
  return upsertOrReplaceLinked(
    { ...doc, docType: 'resume' },
    { applicationId: doc.applicationId, talentPoolId: doc.talentPoolId },
  );
}

export async function upsertCandidateDocument(doc: DocumentInput): Promise<string> {
  if (doc.docType === 'portfolio' || doc.docType === 'other' || doc.docType === 'cover_letter') {
    if (doc.applicationId) return upsertApplicationAttachment(doc);
  }
  return upsertOrReplaceLinked(doc, {
    applicationId: doc.applicationId,
    talentPoolId: doc.talentPoolId,
  });
}
