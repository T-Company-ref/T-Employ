/**
 * 누락 PDF를 배치(기본 5명)마다 브라우저 새로 열어 수집한다.
 *
 * usage:
 *   npm run pdf:all-missing
 *   npm run pdf:all-missing -- --batch 5
 *   npm run pdf:all-missing -- --applicants-only
 *   npm run pdf:all-missing -- --talents-only
 */
import { closePool, query } from '../db/client.js';
import { runFetchApplicantPdfs } from '../crawler/resume/fetchApplicantPdfsBatch.js';
import { fetchTalentBatch } from './fetchTalentPdfsBatch.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseBatchSize(): number {
  const idx = process.argv.indexOf('--batch');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const fromEnv = Number(process.env.PDF_BATCH_SIZE || process.env.PDF_MAX_ITEMS || '5');
  return !Number.isNaN(fromEnv) && fromEnv > 0 ? fromEnv : 5;
}

async function countMissingApplicants(): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM applications a
     LEFT JOIN LATERAL (
       SELECT file_url FROM candidate_documents
       WHERE application_id = a.id AND doc_type = 'resume'
       ORDER BY collected_at DESC NULLS LAST LIMIT 1
     ) d ON true
     WHERE a.platform = 'jobkorea'
       AND a.is_active = true
       AND (d.file_url IS NULL OR d.file_url NOT LIKE 'http%')`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

async function countMissingTalents(): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM talent_pool_candidates t
     LEFT JOIN LATERAL (
       SELECT file_url FROM candidate_documents
       WHERE talent_pool_id = t.id AND doc_type = 'resume'
       ORDER BY collected_at DESC NULLS LAST LIMIT 1
     ) d ON true
     WHERE t.is_active = true
       AND t.profile_url IS NOT NULL
       AND t.candidate_id IS NOT NULL
       AND (d.file_url IS NULL OR d.file_url NOT LIKE 'http%')`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

async function runApplicantBatches(batch: number): Promise<void> {
  let round = 0;
  while (true) {
    const before = await countMissingApplicants();
    if (before === 0) {
      console.log('[pdf:all] 지원자 PDF — 누락 없음');
      return;
    }
    round += 1;
    console.log(`[pdf:all] 지원자 배치 #${round} (누락 ${before}명, 이번 ${Math.min(batch, before)}명)`);
    const result = await runFetchApplicantPdfs({ limit: batch });
    const after = await countMissingApplicants();
    console.log(
      `[pdf:all] 지원자 배치 #${round} saved=${result.saved} failed=${result.failed} DB누락 ${before}→${after}`,
    );
    if (result.targets === 0 || after === 0) return;
    if (result.saved === 0 && result.failed >= result.targets) {
      console.warn('[pdf:all] 지원자 — 진행 없음, 중단');
      return;
    }
    await sleep(2500);
  }
}

async function runTalentBatches(batch: number): Promise<void> {
  let round = 0;
  while (true) {
    const before = await countMissingTalents();
    if (before === 0) {
      console.log('[pdf:all] 인재 PDF — 누락 없음');
      return;
    }
    round += 1;
    console.log(`[pdf:all] 인재 배치 #${round} (누락 ${before}명, 이번 ${Math.min(batch, before)}명)`);
    const result = await fetchTalentBatch(batch);
    const after = await countMissingTalents();
    console.log(
      `[pdf:all] 인재 배치 #${round} saved=${result.saved} failed=${result.failed} DB누락 ${before}→${after}`,
    );
    if (result.targets === 0 || after === 0) return;
    if (result.saved === 0 && result.failed >= result.targets) {
      console.warn('[pdf:all] 인재 — 진행 없음, 중단');
      return;
    }
    await sleep(2500);
  }
}

async function main(): Promise<void> {
  process.env.CRAWL_FETCH_RESUMES = 'true';
  process.env.HEADLESS = process.env.HEADLESS || 'true';

  const batch = parseBatchSize();
  const applicantsOnly = process.argv.includes('--applicants-only');
  const talentsOnly = process.argv.includes('--talents-only');

  console.log(`[pdf:all] 배치 크기 ${batch}명`);

  if (!talentsOnly) await runApplicantBatches(batch);
  if (!applicantsOnly) await runTalentBatches(batch);

  const missApp = await countMissingApplicants();
  const missTalent = await countMissingTalents();
  console.log(`[pdf:all] 완료 — 지원자 누락 ${missApp} · 인재 누락 ${missTalent}`);
  if (missApp > 0 || missTalent > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
