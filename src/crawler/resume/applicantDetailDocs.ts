import type { Page } from 'playwright';
import type { RouteMap } from '../types.js';
import { fetchJobkoreaResumePdf, MIN_RESUME_PDF_BYTES } from './jobkoreaResume.js';
import { storeResumePdf } from '../../db/storage.js';
import {
  replaceApplicationResumeDocument,
  upsertApplicationAttachment,
} from '../../db/repositories/documents.js';

export type AttachmentLink = {
  label: string;
  fileName: string;
  href: string;
};

/** 지원자 상세(.base.portfolio)에서 첨부/포트폴리오 링크 추출 */
export async function extractApplicantAttachmentLinks(page: Page): Promise<AttachmentLink[]> {
  return page.evaluate(() => {
    const out: Array<{ label: string; fileName: string; href: string }> = [];
    const seen = new Set<string>();

    const roots = Array.from(
      document.querySelectorAll('.base.portfolio, .portfolio, [class*="portfolio"]'),
    );
    const scope = roots.length ? roots : [document.body];

    for (const root of scope) {
      const rows = root.querySelectorAll('tr');
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('th, td'));
        const label = (cells[0]?.textContent || '').replace(/\s+/g, ' ').trim() || '첨부';
        for (const a of Array.from(tr.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).href;
          if (!href || !/\/files\/|download|File/i.test(href)) continue;
          const fileName = (a.textContent || '').replace(/\s+/g, ' ').trim() || '첨부파일';
          if (seen.has(href)) continue;
          seen.add(href);
          out.push({ label, fileName, href });
        }
      }

      for (const a of Array.from(
        root.querySelectorAll('a[href*="/files/"], a[href*="download"]'),
      )) {
        const href = (a as HTMLAnchorElement).href;
        if (!href || seen.has(href)) continue;
        const fileName = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!fileName) continue;
        seen.add(href);
        out.push({ label: '첨부', fileName, href });
      }
    }
    return out;
  });
}

export async function downloadAttachmentBytes(page: Page, href: string): Promise<Buffer | null> {
  try {
    const res = await page.request.get(href, { timeout: 60_000 });
    if (!res.ok()) {
      console.warn(`[attach] download HTTP ${res.status()} ${href.slice(0, 80)}`);
      return null;
    }
    const buf = Buffer.from(await res.body());
    if (buf.length < 500) {
      console.warn(`[attach] too small ${buf.length}B`);
      return null;
    }
    return buf;
  } catch (err) {
    console.warn('[attach] download failed', err instanceof Error ? err.message : err);
    return null;
  }
}

function safeRefPart(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  if (ascii && /[A-Za-z0-9]/.test(ascii)) return ascii;
  // 한글 파일명 등 — 저장소 키는 ASCII 만 허용
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `f${h.toString(16)}`;
}

/** 목록 행에서 상세로 진입 (팝업 또는 같은 탭) */
export async function openApplicantDetailFromRow(
  listPage: Page,
  row: ReturnType<Page['locator']>,
): Promise<{ detail: Page; close: () => Promise<void> }> {
  const link = row
    .locator('a.devTypeAplctHref, a.applicant-box.devTypeAplctHref, a[href*="ResumeDB"]')
    .first();
  const popupPromise = listPage.waitForEvent('popup', { timeout: 8_000 }).catch(() => null);
  await link.click({ force: true });
  const popup = await popupPromise;
  const detail = popup || listPage;
  await detail.waitForLoadState('domcontentloaded').catch(() => undefined);
  await detail.waitForTimeout(2000);
  await detail
    .locator('button.button-download, button:has-text("인쇄"), .base.portfolio, .sidemenu')
    .first()
    .waitFor({ timeout: 12_000 })
    .catch(() => undefined);

  return {
    detail,
    close: async () => {
      if (popup) await popup.close().catch(() => undefined);
    },
  };
}

export async function saveApplicantResumePdf(params: {
  candidateId: string;
  applicationId: string;
  externalRef: string;
  pdf: Buffer;
}): Promise<string> {
  const stored = await storeResumePdf({
    platform: 'jobkorea',
    ref: `applicant-${params.externalRef}`,
    pdf: params.pdf,
  });
  await replaceApplicationResumeDocument({
    candidateId: params.candidateId,
    applicationId: params.applicationId,
    file: stored,
    sourceName: 'resume.pdf',
    sourceLabel: '이력서',
  });
  return stored.fileUrl;
}

export async function saveApplicantAttachments(params: {
  page: Page;
  candidateId: string;
  applicationId: string;
  externalRef: string;
}): Promise<number> {
  const links = await extractApplicantAttachmentLinks(params.page);
  let saved = 0;
  for (const link of links) {
    const bytes = await downloadAttachmentBytes(params.page, link.href);
    if (!bytes) continue;
    const stored = await storeResumePdf({
      platform: 'jobkorea',
      ref: `applicant-${params.externalRef}-att-${safeRefPart(link.fileName)}`,
      pdf: bytes,
    });
    await upsertApplicationAttachment({
      candidateId: params.candidateId,
      applicationId: params.applicationId,
      docType: /포트폴리오/i.test(link.label) ? 'portfolio' : 'other',
      file: stored,
      sourceName: link.fileName,
      sourceLabel: link.label,
    });
    saved += 1;
    console.log(`  attach ${link.fileName} ${bytes.length}B`);
  }
  return saved;
}

/** 상세 페이지에서 첨부 + (필요 시) 이력서 인쇄 PDF 수집 */
export async function collectFromApplicantDetail(params: {
  detail: Page;
  routeMap: RouteMap;
  candidateId: string;
  applicationId: string;
  externalRef: string;
  needResume: boolean;
}): Promise<{ resumeSaved: boolean; attachmentsSaved: number }> {
  const attachmentsSaved = await saveApplicantAttachments({
    page: params.detail,
    candidateId: params.candidateId,
    applicationId: params.applicationId,
    externalRef: params.externalRef,
  });

  let resumeSaved = false;
  if (params.needResume) {
    const pdf = await fetchJobkoreaResumePdf(
      params.detail,
      params.routeMap,
      params.detail.url(),
      'applicant',
    );
    if (pdf && pdf.length >= MIN_RESUME_PDF_BYTES) {
      await saveApplicantResumePdf({
        candidateId: params.candidateId,
        applicationId: params.applicationId,
        externalRef: params.externalRef,
        pdf,
      });
      resumeSaved = true;
      console.log(`  resume ${pdf.length}B`);
    } else {
      console.log('  resume failed');
    }
  }

  return { resumeSaved, attachmentsSaved };
}
