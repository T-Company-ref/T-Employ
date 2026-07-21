import { env } from '../config/env.js';
import { loadRouteMap } from '../crawler/routeMap.js';
import { openSession } from '../crawler/browser.js';
import { getConnector } from '../crawler/connectors/index.js';
import {
  fetchJobkoreaResumePdf,
  MIN_RESUME_PDF_BYTES,
} from '../crawler/resume/jobkoreaResume.js';
import { storeResumePdf } from '../db/storage.js';
import { replaceTalentResumeDocument } from '../db/repositories/documents.js';
import { query, closePool } from '../db/client.js';

type Target = {
  id: string;
  candidate_id: string;
  profile_ref: string;
  profile_url: string | null;
  name: string | null;
  file_url: string | null;
};

async function pdfBytes(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const len = res.headers.get('content-length');
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

async function ensureCandidateIds(): Promise<number> {
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

/** active 인재 전체에서 PDF 없음·깨짐·작은 파일 목록 (우선순위: alerted → created) */
async function listBrokenTalents(limit?: number): Promise<Target[]> {
  const res = await query<Target>(
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

  const out: Target[] = [];
  for (const row of res.rows) {
    if (!row.candidate_id) continue;
    if (!row.file_url?.startsWith('http')) {
      out.push(row);
    } else {
      const bytes = await pdfBytes(row.file_url);
      if (bytes === null || bytes < MIN_RESUME_PDF_BYTES) out.push(row);
    }
    if (limit != null && limit > 0 && out.length >= limit) break;
  }
  return out;
}

async function countTalentPdfStatus(): Promise<{ total: number; ok: number; broken: number }> {
  const res = await query<{ id: string; profile_url: string | null; file_url: string | null }>(
    `SELECT t.id, t.profile_url, d.file_url
     FROM talent_pool_candidates t
     LEFT JOIN LATERAL (
       SELECT file_url FROM candidate_documents
       WHERE talent_pool_id = t.id AND doc_type = 'resume'
       ORDER BY collected_at DESC NULLS LAST LIMIT 1
     ) d ON true
     WHERE t.is_active = true`,
  );

  let ok = 0;
  let broken = 0;
  for (const row of res.rows) {
    if (!row.profile_url) {
      broken += 1;
      continue;
    }
    if (!row.file_url?.startsWith('http')) {
      broken += 1;
      continue;
    }
    const bytes = await pdfBytes(row.file_url);
    if (bytes === null || bytes < MIN_RESUME_PDF_BYTES) broken += 1;
    else ok += 1;
  }
  return { total: res.rows.length, ok, broken };
}

/** 인재 PDF 재수집: profile URL → 「인쇄하기」팝업 동의 → print 페이지 PDF */
async function main() {
  process.env.CRAWL_FETCH_RESUMES = 'true';
  process.env.HEADLESS = process.env.HEADLESS || 'true';
  const maxItems = Number(process.env.CRAWL_MAX_ITEMS || '0'); // 0 = 제한 없음

  const cleaned = await query(
    `UPDATE talent_pool_candidates
     SET headline = trim(both FROM regexp_replace(regexp_replace(coalesce(headline,''), '화살표', '', 'g'), '\\s+', ' ', 'g'))
     WHERE headline LIKE '%화살표%'
     RETURNING id`,
  );
  console.log(`[fetch-talent-pdf] 화살표 헤드라인 정리 ${cleaned.rows.length}건`);

  const linked = await ensureCandidateIds();
  if (linked > 0) console.log(`[fetch-talent-pdf] candidate_id 연결 ${linked}건`);

  const before = await countTalentPdfStatus();
  console.log(
    `[fetch-talent-pdf] 현황 active=${before.total} ok=${before.ok} broken=${before.broken}`,
  );

  const targets = await listBrokenTalents(maxItems > 0 ? maxItems : undefined);
  console.log(`[fetch-talent-pdf] 대상 ${targets.length}명`);
  if (targets.length === 0) {
    console.log('[fetch-talent-pdf] 수집할 인재 없음');
    return;
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
  const login = await getConnector(platform).login(ctx, env.platformCreds(platform));
  if (!login.ok) throw new Error(`login failed: ${login.reason}`);

  let saved = 0;
  let failed = 0;
  for (const row of targets) {
    console.log(`[capture] ${row.name} ${row.profile_ref}`);
    if (!row.candidate_id) {
      console.log('  skip: no candidate_id');
      failed += 1;
      continue;
    }
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

  const after = await countTalentPdfStatus();
  console.log(
    `[fetch-talent-pdf] 완료 saved=${saved} failed=${failed} | ok=${after.ok} broken=${after.broken}`,
  );
  await session.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
