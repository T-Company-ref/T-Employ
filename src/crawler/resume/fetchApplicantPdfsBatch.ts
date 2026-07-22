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

export type ApplicantPdfTarget = {
  id: string;
  candidate_id: string;
  external_ref: string;
  name: string | null;
  file_url: string | null;
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
    attach_count: number;
    attachments_checked_at: string | null;
  }>(
    `SELECT a.id,
            a.candidate_id,
            a.external_ref,
            c.name,
            d.file_url,
            coalesce(att.cnt, 0)::int AS attach_count,
            a.profile_meta->>'attachmentsCheckedAt' AS attachments_checked_at
     FROM applications a
     LEFT JOIN candidates c ON c.id = a.candidate_id
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

  const out: ApplicantPdfTarget[] = [];
  for (const row of res.rows) {
    let needResume = !row.file_url?.startsWith('http');
    if (!needResume && options.repairInvalid && row.file_url) {
      const probe = await probeStoredPdf(row.file_url);
      needResume = needsPdfRefetch(probe);
    }
    const needAttach =
      wantAttach && row.attach_count === 0 && !row.attachments_checked_at;
    if (!needResume && !needAttach) continue;
    out.push({
      id: row.id,
      candidate_id: row.candidate_id,
      external_ref: row.external_ref,
      name: row.name,
      file_url: row.file_url,
      attach_count: row.attach_count,
      need_resume: needResume,
      need_attach: needAttach,
    });
    if (options.limit != null && options.limit > 0 && out.length >= options.limit) break;
  }
  return out;
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
        console.log(`[detail] ${meta.name} ${ref} resume=${meta.need_resume} attach=${meta.need_attach}`);
        try {
          const opened = await openApplicantDetailFromRow(session.page, row);
          try {
            const result = await collectFromApplicantDetail({
              detail: opened.detail,
              routeMap,
              candidateId: meta.candidate_id,
              applicationId: meta.id,
              externalRef: ref,
              needResume: meta.need_resume,
            });
            attachmentsSaved += result.attachmentsSaved;
            await query(
              `UPDATE applications
               SET profile_meta = coalesce(profile_meta, '{}'::jsonb)
                 || jsonb_build_object('attachmentsCheckedAt', $2::text)
               WHERE id = $1`,
              [meta.id, new Date().toISOString()],
            );

            const resumeOk = !meta.need_resume || result.resumeSaved;
            if (!resumeOk) {
              failed += 1;
            } else {
              saved += 1;
              remaining.delete(ref);
            }
          } finally {
            await opened.close();
            // 팝업이 아니면 목록 재진입
            if (!session.page.url().includes('Applicant/list')) {
              await session.page.goto(
                `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${giNo}&PageCode=YA`,
                { waitUntil: 'domcontentloaded' },
              );
            }
          }
        } catch (err) {
          console.log('  failed', err instanceof Error ? err.message : err);
          failed += 1;
        }
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
