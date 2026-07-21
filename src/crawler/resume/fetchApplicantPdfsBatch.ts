import { env } from '../../config/env.js';
import { loadRouteMap, resolveSelector } from '../routeMap.js';
import { openSession } from '../browser.js';
import { getConnector } from '../connectors/index.js';
import { fetchApplicantResumeViaPopup } from './jobkoreaResume.js';
import { storeResumePdf } from '../../db/storage.js';
import { replaceApplicationResumeDocument } from '../../db/repositories/documents.js';
import { needsPdfRefetch, probeStoredPdf } from '../../db/probeStoredPdf.js';
import { query } from '../../db/client.js';

export type ApplicantPdfTarget = {
  id: string;
  candidate_id: string;
  external_ref: string;
  name: string | null;
  file_url: string | null;
};

export type FetchApplicantPdfsResult = {
  targets: number;
  saved: number;
  failed: number;
  remaining: number;
};

async function listTargets(options: {
  onlyRef?: string;
  repairInvalid?: boolean;
  limit?: number;
}): Promise<ApplicantPdfTarget[]> {
  const res = await query<ApplicantPdfTarget>(
    `SELECT a.id,
            a.candidate_id,
            a.external_ref,
            c.name,
            d.file_url
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN LATERAL (
       SELECT file_url
       FROM candidate_documents
       WHERE application_id = a.id AND doc_type = 'resume'
       ORDER BY collected_at DESC NULLS LAST
       LIMIT 1
     ) d ON true
     WHERE a.platform = 'jobkorea'
       AND a.is_active = true
       AND ($1::text IS NULL OR a.external_ref = $1)
       AND (
         ($2::boolean = false AND (d.file_url IS NULL OR d.file_url NOT LIKE 'http%'))
         OR $2::boolean = true
       )
     ORDER BY a.applied_at DESC NULLS LAST`,
    [options.onlyRef ?? null, Boolean(options.repairInvalid)],
  );

  const out: ApplicantPdfTarget[] = [];
  for (const row of res.rows) {
    if (!row.file_url?.startsWith('http')) {
      out.push(row);
    } else if (options.repairInvalid) {
      const probe = await probeStoredPdf(row.file_url);
      if (needsPdfRefetch(probe)) out.push(row);
    }
    if (options.limit != null && options.limit > 0 && out.length >= options.limit) break;
  }
  return out;
}

async function savePdf(row: ApplicantPdfTarget, pdf: Buffer): Promise<string> {
  const stored = await storeResumePdf({
    platform: 'jobkorea',
    ref: `applicant-${row.external_ref}`,
    pdf,
  });
  await replaceApplicationResumeDocument({
    candidateId: row.candidate_id,
    applicationId: row.id,
    file: stored,
  });
  return stored.fileUrl;
}

/** Playwright 팝업 인쇄로 누락/깨진 지원자 PDF 수집 */
export async function runFetchApplicantPdfs(options: {
  onlyRef?: string;
  repairInvalid?: boolean;
  limit?: number;
}): Promise<FetchApplicantPdfsResult> {
  const targets = await listTargets(options);
  console.log(
    `[fetch-pdf] 대상 ${targets.length}명 (repair=${Boolean(options.repairInvalid)} limit=${options.limit ?? '∞'})`,
  );
  if (targets.length === 0) {
    return { targets: 0, saved: 0, failed: 0, remaining: 0 };
  }

  const byRef = new Map(targets.map((m) => [m.external_ref, m]));
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

  try {
    const login = await connector.login(ctx, env.platformCreds(platform));
    if (!login.ok) throw new Error(`login failed: ${login.reason}`);
    await session.saveSession();

    let saved = 0;
    let failed = 0;
    const giNos: string[] = [];

    for (const pubType of ['1', '2']) {
      await session.page.goto(`https://www.jobkorea.co.kr/Corp/GIMng/List?PubType=${pubType}`, {
        waitUntil: 'domcontentloaded',
      });
      const hasList = await session.page
        .waitForSelector('.giListItem', { timeout: 12_000 })
        .catch(() => null);
      if (!hasList) continue;

      const ids = await session.page.locator('a.tit.devLinkExpire').evaluateAll((els) => {
        const out: string[] = [];
        for (const el of els) {
          const href = el.getAttribute('href') || '';
          const m = href.match(/GI_No=(\d+)/i);
          if (m) out.push(m[1]);
        }
        return out;
      });
      giNos.push(...ids);
    }

    const uniqueGiNos = [...new Set(giNos)];
    const rowSel = resolveSelector(routeMap, 'applicant_row');
    const remaining = new Set(byRef.keys());

    for (const giNo of uniqueGiNos) {
      if (remaining.size === 0) break;
      await session.page.goto(
        `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${giNo}&PageCode=YA`,
        { waitUntil: 'domcontentloaded' },
      );
      const has = await session.page
        .locator(rowSel)
        .first()
        .isVisible({ timeout: 8_000 })
        .catch(() => false);
      if (!has) continue;

      const n = await session.page.locator(rowSel).count();
      for (let i = 0; i < n; i++) {
        if (remaining.size === 0) break;
        const row = session.page.locator(rowSel).nth(i);
        const ref = await row.getAttribute('data-pssno');
        if (!ref || !remaining.has(ref)) continue;

        const meta = byRef.get(ref)!;
        console.log(`[popup] ${meta.name} ${ref}`);
        let pdf = await fetchApplicantResumeViaPopup(session.page, routeMap, row);
        if (!pdf) {
          await session.page.waitForTimeout(800);
          pdf = await fetchApplicantResumeViaPopup(session.page, routeMap, row);
        }
        if (!pdf) {
          console.log('  failed');
          failed += 1;
          continue;
        }
        const url = await savePdf(meta, pdf);
        remaining.delete(ref);
        saved += 1;
        console.log(`  saved ${pdf.length}B → ${url}`);
      }
    }

    if (remaining.size > 0) {
      console.log(
        '미수집:',
        [...remaining].map((ref) => `${byRef.get(ref)?.name}(${ref})`).join(', '),
      );
    }

    return { targets: targets.length, saved, failed, remaining: remaining.size };
  } finally {
    await session.close().catch(() => undefined);
  }
}
