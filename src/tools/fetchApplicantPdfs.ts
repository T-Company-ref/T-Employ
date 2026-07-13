import { env } from '../config/env.js';
import { loadRouteMap } from '../crawler/routeMap.js';
import { openSession } from '../crawler/browser.js';
import { getConnector } from '../crawler/connectors/index.js';
import { resolveSelector } from '../crawler/routeMap.js';
import { fetchApplicantResumeViaPopup } from '../crawler/resume/jobkoreaResume.js';
import { storeResumePdf } from '../db/storage.js';
import { upsertCandidateDocument } from '../db/repositories/documents.js';
import { query, closePool } from '../db/client.js';

/** 진행중 공고 지원자 중 PDF 없는 건을 팝업 인쇄로 수집 */
async function main() {
  process.env.CRAWL_FETCH_RESUMES = 'true';
  process.env.HEADLESS = 'true';
  const limit = Number(process.env.CRAWL_MAX_ITEMS || '20');

  const platform = 'jobkorea';
  const routeMap = loadRouteMap(platform);
  const connector = getConnector(platform);
  const session = await openSession(platform);
  const ctx = {
    page: session.page,
    routeMap,
    jobId: 'fetch-pdf',
    platform,
    log: async (_l: string, m: string) => console.log(m),
  };
  const login = await connector.login(ctx, env.platformCreds(platform));
  if (!login.ok) throw new Error(`login failed: ${login.reason}`);

  await session.page.goto('https://www.jobkorea.co.kr/Corp/GIMng/List?PubType=1', {
    waitUntil: 'domcontentloaded',
  });
  await session.page.waitForSelector('.giListItem', { timeout: 20_000 });

  const giNos = await session.page.locator('a.tit.devLinkExpire').evaluateAll((els) => {
    const ids: string[] = [];
    for (const el of els) {
      const href = el.getAttribute('href') || '';
      const m = href.match(/GI_No=(\d+)/i);
      if (m) ids.push(m[1]);
    }
    return [...new Set(ids)];
  });

  let saved = 0;
  const rowSel = resolveSelector(routeMap, 'applicant_row');

  for (const giNo of giNos) {
    if (saved >= limit) break;
    await session.page.goto(
      `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${giNo}&PageCode=YA`,
      { waitUntil: 'domcontentloaded' },
    );
    const has = await session.page.locator(rowSel).first().isVisible({ timeout: 8_000 }).catch(() => false);
    if (!has) continue;

    const n = await session.page.locator(rowSel).count();
    for (let i = 0; i < n && saved < limit; i++) {
      // 매 루프 새로 locate (팝업 후 DOM 안정)
      const row = session.page.locator(rowSel).nth(i);
      const ref = await row.getAttribute('data-pssno');
      if (!ref) continue;

      const existing = await query(
        `SELECT d.id FROM candidate_documents d
         JOIN applications a ON a.id = d.application_id
         WHERE a.platform=$1 AND a.external_ref=$2
         LIMIT 1`,
        [platform, ref],
      );
      if (existing.rows[0]) {
        console.log('skip existing', ref);
        continue;
      }

      const name = (await row.locator('.applicant-box .name').textContent())?.trim();
      console.log('fetch', name, ref);
      const pdf = await fetchApplicantResumeViaPopup(session.page, routeMap, row);
      if (!pdf) {
        console.log('  skip null pdf');
        continue;
      }

      const stored = await storeResumePdf({ platform, ref: `applicant-${ref}`, pdf });
      const app = await query<{ id: string; candidate_id: string }>(
        `SELECT id, candidate_id FROM applications WHERE platform=$1 AND external_ref=$2`,
        [platform, ref],
      );
      if (!app.rows[0]) {
        console.log('  no app row');
        continue;
      }
      await upsertCandidateDocument({
        candidateId: app.rows[0].candidate_id,
        applicationId: app.rows[0].id,
        file: stored,
      });
      saved += 1;
      console.log('  saved', stored.fileUrl);
    }
  }

  console.log('done saved=', saved);
  await session.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
