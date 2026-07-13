import type { Page } from 'playwright';
import type { RouteMap } from '../types.js';
import { resolveSelector } from '../routeMap.js';

export type ResumeKind = 'talent' | 'applicant';

async function clickPrintAndAgree(page: Page, routeMap: RouteMap, kind: ResumeKind): Promise<void> {
  const printSel = resolveSelector(
    routeMap,
    kind === 'talent' ? 'talent_print_btn' : 'applicant_print_btn',
  );
  const printBtn = page.locator(printSel).first();
  const hasPrint = await printBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (hasPrint) {
    await printBtn.click();
  } else {
    const fallback = page.getByRole('button', { name: /인쇄/ }).or(page.getByText('인쇄하기')).first();
    if (await fallback.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await fallback.click();
    }
  }

  await page.waitForTimeout(600);

  const agreeSel = resolveSelector(routeMap, 'resume_print_agree');
  const agree = page.locator(agreeSel).first();
  if (await agree.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const tag = await agree.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'input') await agree.check({ force: true });
    else await agree.click();
  } else {
    // 동의 체크박스 텍스트 근처
    const agreeLabel = page.locator('label:has-text("동의"), label:has-text("개인정보")').first();
    if (await agreeLabel.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await agreeLabel.click();
    }
  }

  const confirmSel = resolveSelector(routeMap, 'resume_print_confirm');
  const confirm = page.locator(confirmSel).first();
  if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirm.click();
  } else {
    const okBtn = page.getByRole('button', { name: /확인|동의/ }).first();
    if (await okBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await okBtn.click();
    }
  }

  await page.waitForTimeout(1200);
}

/**
 * 잡코리아 상세 → 인쇄하기 → 개인정보 동의 → PDF 생성.
 * page.pdf() 는 headless Chromium 전용.
 */
export async function fetchJobkoreaResumePdf(
  page: Page,
  routeMap: RouteMap,
  detailUrl: string,
  kind: ResumeKind,
): Promise<Buffer | null> {
  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(800);
    if (await page.locator('text=비정상적인 경로').isVisible({ timeout: 800 }).catch(() => false)) {
      return null;
    }
    await clickPrintAndAgree(page, routeMap, kind);
    return page.pdf({ format: 'A4', printBackground: true });
  } catch {
    return null;
  }
}

/**
 * 지원자 목록에서 이름 링크 클릭 → 팝업(ResumeDB) → 인쇄/동의 → PDF
 */
export async function fetchApplicantResumeViaPopup(
  listPage: Page,
  routeMap: RouteMap,
  rowLocator: import('playwright').Locator,
): Promise<Buffer | null> {
  try {
    const link = rowLocator.locator('a.applicant-box.devTypeAplctHref').first();
    const [popup] = await Promise.all([
      listPage.waitForEvent('popup', { timeout: 12_000 }),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1000);

    if (await popup.locator('text=비정상적인 경로').isVisible({ timeout: 800 }).catch(() => false)) {
      await popup.close().catch(() => undefined);
      return null;
    }

    await clickPrintAndAgree(popup, routeMap, 'applicant');
    const pdf = await popup.pdf({ format: 'A4', printBackground: true });
    await popup.close().catch(() => undefined);
    // 너무 작은 PDF 는 실패로 간주 (빈 페이지/에러)
    if (!pdf || pdf.length < 20_000) return null;
    return pdf;
  } catch {
    return null;
  }
}
