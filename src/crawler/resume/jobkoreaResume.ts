import type { Page } from 'playwright';
import type { RouteMap } from '../types.js';
import { resolveSelector } from '../routeMap.js';

export type ResumeKind = 'talent' | 'applicant';

/** 이보다 작으면 빈 페이지/실패 PDF 로 간주 */
export const MIN_RESUME_PDF_BYTES = 20_000;

/** 인재 상세의 토스트/알림 레이어 제거 (인쇄 클릭 방해) */
async function dismissTalentOverlays(page: Page): Promise<void> {
  const closeToday = page.locator(
    '.notification button.button-close-today, .notification button:has-text("오늘 하루")',
  );
  if (await closeToday.first().isVisible({ timeout: 800 }).catch(() => false)) {
    await closeToday.first().click({ force: true }).catch(() => undefined);
  } else {
    const closeBtn = page.locator('.notification button:has-text("닫기"), .notification [class*="close"]').first();
    if (await closeBtn.isVisible({ timeout: 400 }).catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => undefined);
    }
  }
  await page
    .evaluate(() => {
      document.querySelectorAll('.notification, .toast, [class*="toast"]').forEach((el) => el.remove());
    })
    .catch(() => undefined);
  await page.keyboard.press('Escape').catch(() => undefined);
}

async function clickPrintAndAgree(page: Page, routeMap: RouteMap, kind: ResumeKind): Promise<void> {
  const printSel = resolveSelector(
    routeMap,
    kind === 'talent' ? 'talent_print_btn' : 'applicant_print_btn',
  );
  const printBtn = page.locator(printSel).first();
  const hasPrint = await printBtn.isVisible({ timeout: 8_000 }).catch(() => false);
  if (hasPrint) {
    await printBtn.click();
  } else {
    const fallback = page.getByRole('button', { name: /인쇄/ }).or(page.getByText('인쇄하기')).first();
    if (await fallback.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await fallback.click();
    } else {
      throw new Error('print_button_not_found');
    }
  }

  await page.waitForTimeout(800);

  const agreeSel = resolveSelector(routeMap, 'resume_print_agree');
  const agree = page.locator(agreeSel).first();
  if (await agree.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const tag = await agree.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'input') await agree.check({ force: true });
    else await agree.click();
  } else {
    const agreeLabel = page.locator('label:has-text("동의"), label:has-text("개인정보")').first();
    if (await agreeLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await agreeLabel.click();
    }
  }

  const confirmSel = resolveSelector(routeMap, 'resume_print_confirm');
  const confirm = page.locator(confirmSel).first();
  if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await confirm.click();
  } else {
    const okBtn = page.getByRole('button', { name: /확인|동의/ }).first();
    if (await okBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await okBtn.click();
    }
  }
}

async function waitForResumePrintReady(page: Page, routeMap: RouteMap): Promise<void> {
  const areaSel = resolveSelector(routeMap, 'resume_print_area');
  const area = page.locator(areaSel).first();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const visible = await area.isVisible({ timeout: 500 }).catch(() => false);
    if (visible) {
      const text = await area.innerText().catch(() => '');
      if (text.trim().length > 80) return;
    }
    const bodyText = await page
      .locator('.resumePrint, .devResumePrint, #devPrintArea, .printArea, .resume-view, body')
      .first()
      .innerText()
      .catch(() => '');
    if (bodyText.trim().length > 200) return;
    await page.waitForTimeout(400);
  }

  throw new Error('print_content_not_ready');
}

async function renderResumePdf(page: Page, routeMap: RouteMap, kind: ResumeKind): Promise<Buffer> {
  await clickPrintAndAgree(page, routeMap, kind);
  await waitForResumePrintReady(page, routeMap);
  await page.waitForTimeout(600);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  if (!pdf || pdf.length < MIN_RESUME_PDF_BYTES) {
    throw new Error(`pdf_too_small:${pdf?.length ?? 0}`);
  }
  return pdf;
}

/**
 * 인재 이력서: 「인쇄하기」 → PrintAgree 팝업(라디오 동의) → /resume/print → page.pdf()
 * (상세 페이지에서 바로 page.pdf() 하면 빈 파일(~966B)이 나옴)
 * 이미 동의한 세션은 PrintAgree 없이 /resume/print 로 바로 열릴 수 있다.
 */
async function renderTalentResumePdf(page: Page, routeMap: RouteMap): Promise<Buffer> {
  await dismissTalentOverlays(page);

  const printSel = resolveSelector(routeMap, 'talent_print_btn');
  const printBtn = page.locator(printSel).first();
  const hasPrint = await printBtn.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasPrint) {
    const fallback = page.getByRole('button', { name: /인쇄/ }).or(page.getByText('인쇄하기')).first();
    if (!(await fallback.isVisible({ timeout: 3_000 }).catch(() => false))) {
      throw new Error('print_button_not_found');
    }
  }

  const [agreePopup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15_000 }),
    hasPrint
      ? printBtn.click()
      : page.getByRole('button', { name: /인쇄/ }).or(page.getByText('인쇄하기')).first().click(),
  ]);

  await agreePopup.waitForLoadState('domcontentloaded').catch(() => undefined);
  await agreePopup
    .waitForURL(/PrintAgree|\/resume\/print/i, { timeout: 20_000 })
    .catch(() => undefined);
  await agreePopup.waitForTimeout(400);

  // PrintAgree 단계가 있으면 라디오 동의 후 인쇄
  if (/PrintAgree/i.test(agreePopup.url())) {
    const agreeSel = resolveSelector(routeMap, 'talent_print_agree');
    const radio = agreePopup.locator(agreeSel).first();
    if (await radio.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await radio.check({ force: true });
    } else {
      const label = agreePopup.locator('label:has-text("동의합니다")').first();
      if (await label.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await label.click();
      } else {
        throw new Error(`talent_print_agree_not_found:${agreePopup.url()}`);
      }
    }

    const confirmSel = resolveSelector(routeMap, 'talent_print_confirm');
    const printConfirm = agreePopup
      .locator(confirmSel)
      .or(agreePopup.locator('button:has-text("인쇄하기")'))
      .first();
    if (!(await printConfirm.isVisible({ timeout: 5_000 }).catch(() => false))) {
      throw new Error('talent_print_confirm_not_found');
    }

    await Promise.all([
      agreePopup.waitForURL(/\/resume\/print/i, { timeout: 20_000 }),
      printConfirm.click(),
    ]);
    await agreePopup.waitForLoadState('domcontentloaded').catch(() => undefined);
  }

  if (!/\/resume\/print/i.test(agreePopup.url())) {
    throw new Error(`talent_print_unexpected_url:${agreePopup.url()}`);
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = (await agreePopup.locator('body').innerText().catch(() => '')).trim();
    if (text.length > 500) break;
    await agreePopup.waitForTimeout(400);
  }

  const readyText = (await agreePopup.locator('body').innerText().catch(() => '')).trim();
  if (readyText.length < 200) {
    throw new Error('talent_print_content_not_ready');
  }

  await agreePopup.waitForTimeout(400);
  const pdf = await agreePopup.pdf({ format: 'A4', printBackground: true });
  await agreePopup.close().catch(() => undefined);

  if (!pdf || pdf.length < MIN_RESUME_PDF_BYTES) {
    throw new Error(`pdf_too_small:${pdf?.length ?? 0}`);
  }
  return pdf;
}

export async function fetchJobkoreaResumePdf(
  page: Page,
  routeMap: RouteMap,
  detailUrl: string,
  kind: ResumeKind,
): Promise<Buffer | null> {
  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1200);
    if (await page.locator('text=비정상적인 경로').isVisible({ timeout: 800 }).catch(() => false)) {
      return null;
    }
    if (kind === 'talent') {
      return await renderTalentResumePdf(page, routeMap);
    }
    return await renderResumePdf(page, routeMap, kind);
  } catch (err) {
    console.error('[resume-pdf]', kind, detailUrl, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function fetchApplicantResumeViaPopup(
  listPage: Page,
  routeMap: RouteMap,
  rowLocator: import('playwright').Locator,
): Promise<Buffer | null> {
  try {
    const link = rowLocator.locator('a.applicant-box.devTypeAplctHref').first();
    const [popup] = await Promise.all([
      listPage.waitForEvent('popup', { timeout: 15_000 }),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1200);

    if (await popup.locator('text=비정상적인 경로').isVisible({ timeout: 800 }).catch(() => false)) {
      await popup.close().catch(() => undefined);
      return null;
    }

    const pdf = await renderResumePdf(popup, routeMap, 'applicant');
    await popup.close().catch(() => undefined);
    return pdf;
  } catch {
    return null;
  }
}

export async function fetchTalentResumeViaPopup(
  listPage: Page,
  routeMap: RouteMap,
  rowLocator: import('playwright').Locator,
): Promise<Buffer | null> {
  try {
    const link = rowLocator.locator('a.dvResumeLink, a[href*="Resume"], a[href*="resume"]').first();
    const popupPromise = listPage.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
    await link.click({ timeout: 8_000 });
    const popup = await popupPromise;
    const target = popup ?? listPage;

    if (popup) {
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(1200);
    } else {
      await listPage.waitForLoadState('domcontentloaded');
      await listPage.waitForTimeout(1200);
    }

    if (await target.locator('text=비정상적인 경로').isVisible({ timeout: 800 }).catch(() => false)) {
      if (popup) await popup.close().catch(() => undefined);
      return null;
    }

    const pdf = await renderTalentResumePdf(target, routeMap);
    if (popup) await popup.close().catch(() => undefined);
    return pdf;
  } catch {
    return null;
  }
}
