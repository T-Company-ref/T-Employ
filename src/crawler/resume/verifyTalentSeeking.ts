import type { Page } from 'playwright';
import { classifySeekingText, type SeekingVerdict } from '../../mail/talentSeeking.js';

/**
 * 잡코리아 인재 프로필을 열어 취직 완료/비공개 여부를 확인한다.
 */
export async function verifyTalentSeekingOnPage(
  page: Page,
  profileUrl: string,
): Promise<{ verdict: SeekingVerdict; detail: string }> {
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(900);

    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
    const title = await page.title().catch(() => '');
    const blob = `${title}\n${body}`;

    const verdict = classifySeekingText(blob);
    if (verdict === 'hired' || verdict === 'unavailable') {
      return { verdict, detail: blob.slice(0, 200) };
    }

    // 상태 영역이 있으면 그 텍스트를 우선
    const statusText = (
      await page
        .locator('.hopeTxt, .jobState, .devJobState, .wishType')
        .or(page.getByText(/구직중|재직중|취업완료|이직희망/))
        .first()
        .textContent()
        .catch(() => null)
    )
      ?.replace(/\s+/g, ' ')
      .trim();

    if (statusText) {
      const v2 = classifySeekingText(statusText);
      if (v2 !== 'unknown') return { verdict: v2, detail: statusText };
    }

    return { verdict: verdict === 'seeking' ? 'seeking' : 'unknown', detail: statusText || 'ok' };
  } catch (err) {
    return { verdict: 'unavailable', detail: (err as Error).message };
  }
}
