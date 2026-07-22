import { env } from '../../config/env.js';
import { loadRouteMap, resolveSelector } from '../routeMap.js';
import { openSession } from '../browser.js';
import { getConnector } from '../connectors/index.js';
import { needsPdfRefetch, probeStoredPdf } from '../../db/probeStoredPdf.js';
import { query } from '../../db/client.js';
import {
  collectFromApplicantDetail,
  openApplicantDetailFromRow,
} from './applicantDetailDocs.js';
import type { Page } from 'playwright';

export type ApplicantPdfTarget = {
  id: string;
  candidate_id: string;
  external_ref: string;
  name: string | null;
  file_url: string | null;
  gi_no: string | null;
  attach_count: number;
  need_resume: boolean;
  need_attach: boolean;
};

export type FetchApplicantPdfsResult = {
  targets: number;
  saved: number;
  failed: number;
  remaining: number;
  attachmentsSaved?: number;
};

async function listTargets(options: {
  onlyRef?: string;
  repairInvalid?: boolean;
  limit?: number;
  includeAttachments?: boolean;
}): Promise<ApplicantPdfTarget[]> {
  const wantAttach = options.includeAttachments !== false;
  const res = await query<{
    id: string;
    candidate_id: string;
    external_ref: string;
    name: string | null;
    file_url: string | null;
    gi_no: string | null;
    attach_count: number;
    attachments_checked_at: string | null;
  }>(
    `SELECT a.id,
            a.candidate_id,
            a.external_ref,
            c.name,
            d.file_url,
            coalesce(j.meta->>'GI_No', j.external_posting_id) AS gi_no,
            coalesce(att.cnt, 0)::int AS attach_count,
            a.profile_meta->>'attachmentsCheckedAt' AS attachments_checked_at
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN job_postings j ON j.id = a.posting_id
     LEFT JOIN LATERAL (
       SELECT file_url
       FROM candidate_documents
       WHERE application_id = a.id AND doc_type = 'resume'
       ORDER BY collected_at DESC NULLS LAST
       LIMIT 1
     ) d ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS cnt
       FROM candidate_documents
       WHERE application_id = a.id AND doc_type IN ('portfolio', 'other')
     ) att ON true
     WHERE a.platform = 'jobkorea'
       AND a.is_active = true
       AND ($1::text IS NULL OR a.external_ref = $1)
     ORDER BY a.applied_at DESC NULLS LAST`,
    [options.onlyRef ?? null],
  );

  const candidates: ApplicantPdfTarget[] = [];
  for (const row of res.rows) {
    let needResume = !row.file_url?.startsWith('http');
    if (!needResume && options.repairInvalid && row.file_url) {
      const probe = await probeStoredPdf(row.file_url);
      needResume = needsPdfRefetch(probe);
    }
    const needAttach =
      wantAttach && row.attach_count === 0 && !row.attachments_checked_at;
    if (!needResume && !needAttach) continue;
    candidates.push({
      id: row.id,
      candidate_id: row.candidate_id,
      external_ref: row.external_ref,
      name: row.name,
      file_url: row.file_url,
      gi_no: row.gi_no,
      attach_count: row.attach_count,
      need_resume: needResume,
      need_attach: needAttach,
    });
  }

  // 이력서 누락 우선, 그다음 첨부 미점검
  candidates.sort((a, b) => {
    if (a.need_resume !== b.need_resume) return a.need_resume ? -1 : 1;
    return 0;
  });

  if (options.limit != null && options.limit > 0) {
    return candidates.slice(0, options.limit);
  }
  return candidates;
}

function listUrl(giNo: string, page = 1): string {
  const base = `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${giNo}&PageCode=YA`;
  return page <= 1 ? base : `${base}&Page=${page}`;
}

async function processRow(params: {
  page: Page;
  row: ReturnType<Page['locator']>;
  meta: ApplicantPdfTarget;
  routeMap: ReturnType<typeof loadRouteMap>;
  giNo: string;
  listPageNo: number;
  remaining: Set<string>;
}): Promise<{ saved: boolean; failed: boolean; attachmentsSaved: number }> {
  const { page, row, meta, routeMap, giNo, listPageNo, remaining } = params;
  console.log(`[detail] ${meta.name} ${meta.external_ref} resume=${meta.need_resume} attach=${meta.need_attach}`);
  try {
    const opened = await openApplicantDetailFromRow(page, row);
    try {
      const result = await collectFromApplicantDetail({
        detail: opened.detail,
        routeMap,
        candidateId: meta.candidate_id,
        applicationId: meta.id,
        externalRef: meta.external_ref,
        needResume: meta.need_resume,
      });
      await query(
        `UPDATE applications
         SET profile_meta = coalesce(profile_meta, '{}'::jsonb)
           || jsonb_build_object('attachmentsCheckedAt', $2::text)
         WHERE id = $1`,
        [meta.id, new Date().toISOString()],
      );

      const resumeOk = !meta.need_resume || result.resumeSaved;
      if (!resumeOk) {
        return { saved: false, failed: true, attachmentsSaved: result.attachmentsSaved };
      }
      remaining.delete(meta.external_ref);
      return { saved: true, failed: false, attachmentsSaved: result.attachmentsSaved };
    } finally {
      await opened.close();
      if (!page.url().includes('Applicant/list')) {
        await page.goto(listUrl(giNo, listPageNo), { waitUntil: 'domcontentloaded' });
      }
    }
  } catch (err) {
    console.log('  failed', err instanceof Error ? err.message : err);
    return { saved: false, failed: true, attachmentsSaved: 0 };
  }
}

/** 특정 공고 지원자 목록(페이지네이션)에서 남은 대상 수집 */
async function harvestGiList(params: {
  page: Page;
  giNo: string;
  byRef: Map<string, ApplicantPdfTarget>;
  remaining: Set<string>;
  routeMap: ReturnType<typeof loadRouteMap>;
  rowSel: string;
  maxPages?: number;
}): Promise<{ saved: number; failed: number; attachmentsSaved: number }> {
  let saved = 0;
  let failed = 0;
  let attachmentsSaved = 0;
  const maxPages = params.maxPages ?? 15;

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    if (params.remaining.size === 0) break;
    await params.page.goto(listUrl(params.giNo, pageNo), { waitUntil: 'domcontentloaded' });
    const has = await params.page
      .locator(params.rowSel)
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    if (!has) break;

    const n = await params.page.locator(params.rowSel).count();
    if (n === 0) break;

    // 페이지마다 남은 대상만 data-pssno 로 재조회 (인덱스 밀림 방지)
    const pendingRefs = [...params.remaining];
    for (const ref of pendingRefs) {
      if (!params.remaining.has(ref)) continue;
      const meta = params.byRef.get(ref);
      if (!meta) continue;
      const row = params.page.locator(`${params.rowSel}[data-pssno="${ref}"]`).first();
      if (!(await row.count())) continue;
      const result = await processRow({
        page: params.page,
        row,
        meta,
        routeMap: params.routeMap,
        giNo: params.giNo,
        listPageNo: pageNo,
        remaining: params.remaining,
      });
      if (result.saved) saved += 1;
      if (result.failed) failed += 1;
      attachmentsSaved += result.attachmentsSaved;
      if (!params.page.url().includes('Applicant/list')) {
        await params.page.goto(listUrl(params.giNo, pageNo), { waitUntil: 'domcontentloaded' });
      }
    }
  }

  return { saved, failed, attachmentsSaved };
}

/** 지원자 상세에서 이력서(인쇄) + 첨부/포트폴리오 수집 */
export async function runFetchApplicantPdfs(options: {
  onlyRef?: string;
  repairInvalid?: boolean;
  limit?: number;
  includeAttachments?: boolean;
}): Promise<FetchApplicantPdfsResult> {
  const targets = await listTargets(options);
  console.log(
    `[fetch-pdf] 대상 ${targets.length}명 (repair=${Boolean(options.repairInvalid)} attach=${options.includeAttachments !== false} limit=${options.limit ?? '∞'})`,
  );
  if (targets.length === 0) {
    return { targets: 0, saved: 0, failed: 0, remaining: 0, attachmentsSaved: 0 };
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
    let attachmentsSaved = 0;
    const remaining = new Set(byRef.keys());
    const rowSel = resolveSelector(routeMap, 'applicant_row');

    // 1) DB에 연결된 공고 GI 우선 (페이지네이션 포함)
    const giFromTargets = [
      ...new Set(targets.map((t) => t.gi_no).filter((g): g is string => Boolean(g))),
    ];
    for (const giNo of giFromTargets) {
      if (remaining.size === 0) break;
      const r = await harvestGiList({
        page: session.page,
        giNo,
        byRef,
        remaining,
        routeMap,
        rowSel,
      });
      saved += r.saved;
      failed += r.failed;
      attachmentsSaved += r.attachmentsSaved;
    }

    // 2) 공고관리 목록에서 추가 GI 스캔 (DB 공고와 다를 수 있음)
    if (remaining.size > 0) {
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

      for (const giNo of [...new Set(giNos)]) {
        if (remaining.size === 0) break;
        if (giFromTargets.includes(giNo)) continue;
        const r = await harvestGiList({
          page: session.page,
          giNo,
          byRef,
          remaining,
          routeMap,
          rowSel,
        });
        saved += r.saved;
        failed += r.failed;
        attachmentsSaved += r.attachmentsSaved;
      }
    }

    if (remaining.size > 0) {
      console.log(
        '미수집:',
        [...remaining].map((ref) => `${byRef.get(ref)?.name}(${ref})`).join(', '),
      );
    }

    return {
      targets: targets.length,
      saved,
      failed,
      remaining: remaining.size,
      attachmentsSaved,
    };
  } finally {
    await session.close().catch(() => undefined);
  }
}
