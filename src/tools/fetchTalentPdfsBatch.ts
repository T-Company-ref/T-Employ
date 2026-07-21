import { env } from '../config/env.js';
import { loadRouteMap } from '../crawler/routeMap.js';
import { openSession } from '../crawler/browser.js';
import { getConnector } from '../crawler/connectors/index.js';
import { fetchJobkoreaResumePdf } from '../crawler/resume/jobkoreaResume.js';
import { storeResumePdf } from '../db/storage.js';
import { replaceTalentResumeDocument } from '../db/repositories/documents.js';
import { needsPdfRefetch, probeStoredPdf } from '../db/probeStoredPdf.js';
import { query } from '../db/client.js';

export type TalentPdfTarget = {
  id: string;
  candidate_id: string;
  profile_ref: string;
  profile_url: string | null;
  name: string | null;
  file_url: string | null;
};

export type TalentPdfBatchResult = {
  targets: number;
  saved: number;
  failed: number;
};

export async function ensureTalentCandidateIds(): Promise<number> {
  const rows = await query<{ id: string; headline: string | null; profile_ref: string }>(
    `SELECT id, headline, profile_ref
     FROM talent_pool_candidates
     WHERE is_active = true AND candidate_id IS NULL`,
  );
  let linked = 0;
  for (const row of rows.rows) {
    const label = row.headline?.replace(/\s+/g, ' ').trim().slice(0, 40) || `인재-${row.profile_ref}`;
    const created = await query<{ id: string }>(
      `INSERT INTO candidates (name, source_type) VALUES ($1, 'talent_pool') RETURNING id`,
      [label],
    );
    await query(`UPDATE talent_pool_candidates SET candidate_id = $1 WHERE id = $2`, [
      created.rows[0].id,
      row.id,
    ]);
    linked += 1;
  }
  return linked;
}

/** PDF 없음·깨짐 인재 (우선순위: alerted → created) */
export async function listBrokenTalents(limit?: number): Promise<TalentPdfTarget[]> {
  const res = await query<TalentPdfTarget>(
    `SELECT t.id, t.candidate_id, t.profile_ref, t.profile_url, c.name, d.file_url
     FROM talent_pool_candidates t
     LEFT JOIN candidates c ON c.id = t.candidate_id
     LEFT JOIN LATERAL (
       SELECT file_url
       FROM candidate_documents
       WHERE talent_pool_id = t.id AND doc_type = 'resume'
       ORDER BY collected_at DESC NULLS LAST
       LIMIT 1
     ) d ON true
     WHERE t.is_active = true
       AND t.profile_url IS NOT NULL
     ORDER BY t.alerted_at DESC NULLS LAST, t.created_at DESC`,
  );

  const out: TalentPdfTarget[] = [];
  for (const row of res.rows) {
    if (!row.candidate_id) continue;
    if (!row.file_url?.startsWith('http')) {
      out.push(row);
    } else {
      const probe = await probeStoredPdf(row.file_url);
      // HEAD/네트워크 실패(unknown)는 재수집하지 않음 — 정상 PDF 덮어쓰기 방지
      if (needsPdfRefetch(probe)) out.push(row);
    }
    if (limit != null && limit > 0 && out.length >= limit) break;
  }
  return out;
}

/** 인재 PDF 배치 — 브라우저 1회 열어 limit명만 수집 후 종료 */
export async function fetchTalentBatch(limit: number): Promise<TalentPdfBatchResult> {
  await ensureTalentCandidateIds();
  const targets = await listBrokenTalents(limit);
  if (targets.length === 0) {
    return { targets: 0, saved: 0, failed: 0 };
  }

  const platform = 'jobkorea';
  const routeMap = loadRouteMap(platform);
  const session = await openSession(platform);
  const ctx = {
    page: session.page,
    routeMap,
    jobId: 'fetch-talent-pdf',
    platform,
    log: async (_l: string, m: string) => console.log(m),
  };

  try {
    const login = await getConnector(platform).login(ctx, env.platformCreds(platform));
    if (!login.ok) throw new Error(`login failed: ${login.reason}`);
    await session.saveSession();

    let saved = 0;
    let failed = 0;
    for (const row of targets) {
      console.log(`[capture] ${row.name} ${row.profile_ref}`);
      const pdf = await fetchJobkoreaResumePdf(session.page, routeMap, row.profile_url!, 'talent');
      if (!pdf) {
        console.log('  failed');
        failed += 1;
        continue;
      }
      const stored = await storeResumePdf({ platform, ref: row.profile_ref, pdf });
      await replaceTalentResumeDocument({
        candidateId: row.candidate_id,
        talentPoolId: row.id,
        file: stored,
      });
      saved += 1;
      console.log(`  saved ${pdf.length}B`);
    }
    return { targets: targets.length, saved, failed };
  } finally {
    await session.close().catch(() => undefined);
  }
}
