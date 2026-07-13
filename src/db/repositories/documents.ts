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

/** 이력서 PDF 메타를 candidate_documents 에 upsert */
export async function upsertCandidateDocument(doc: DocumentInput): Promise<string> {
  return withTransaction(async (client) => {
    if (doc.file.fileHash) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM candidate_documents WHERE file_hash = $1 LIMIT 1`,
        [doc.file.fileHash],
      );
      if (existing.rows[0]?.id) return existing.rows[0].id;
    }

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
  });
}
