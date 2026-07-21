import { closePool, query } from '../db/client.js';
import { fetchTalentBatch, ensureTalentCandidateIds } from './fetchTalentPdfsBatch.js';

async function countTalentPdfStatus(): Promise<{ total: number; ok: number; broken: number }> {
  const res = await query<{ profile_url: string | null; file_url: string | null }>(
    `SELECT t.profile_url, d.file_url
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
    if (!row.profile_url || !row.file_url?.startsWith('http')) {
      broken += 1;
      continue;
    }
    ok += 1;
  }
  return { total: res.rows.length, ok, broken };
}

function parseLimit(): number {
  const maxItems = Number(process.env.CRAWL_MAX_ITEMS || process.env.PDF_MAX_ITEMS || '5');
  return !Number.isNaN(maxItems) && maxItems > 0 ? maxItems : 5;
}

/** 인재 PDF 재수집 (기본 5명/회) */
async function main() {
  process.env.CRAWL_FETCH_RESUMES = 'true';
  process.env.HEADLESS = process.env.HEADLESS || 'true';
  const limit = parseLimit();

  const cleaned = await query(
    `UPDATE talent_pool_candidates
     SET headline = trim(both FROM regexp_replace(regexp_replace(coalesce(headline,''), '화살표', '', 'g'), '\\s+', ' ', 'g'))
     WHERE headline LIKE '%화살표%'
     RETURNING id`,
  );
  console.log(`[fetch-talent-pdf] 화살표 헤드라인 정리 ${cleaned.rows.length}건`);

  const linked = await ensureTalentCandidateIds();
  if (linked > 0) console.log(`[fetch-talent-pdf] candidate_id 연결 ${linked}건`);

  const before = await countTalentPdfStatus();
  console.log(
    `[fetch-talent-pdf] 현황 active=${before.total} ok=${before.ok} broken=${before.broken}`,
  );

  const result = await fetchTalentBatch(limit);
  console.log(`[fetch-talent-pdf] 대상 ${result.targets}명 (limit=${limit})`);
  if (result.targets === 0) {
    console.log('[fetch-talent-pdf] 수집할 인재 없음');
    return;
  }

  const after = await countTalentPdfStatus();
  console.log(
    `[fetch-talent-pdf] 완료 saved=${result.saved} failed=${result.failed} | ok=${after.ok} broken=${after.broken}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
