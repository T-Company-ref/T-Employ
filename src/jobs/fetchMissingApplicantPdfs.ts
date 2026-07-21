/**
 * 지원자 이력서 PDF 배치 (Playwright 인쇄 — 폴링과 분리).
 *
 * usage:
 *   npm run pdf:applicants
 *   npm run pdf:applicants -- --limit 10
 *   npm run pdf:applicants -- --repair
 *   npm run pdf:applicants -- --ref=438636484
 */
import { closePool } from '../db/client.js';
import { sendOpsAlert } from '../mail/alerts.js';
import { handleAuthFailure } from '../mail/sessionAuthAlert.js';
import { markSessionOk } from '../crawler/session/authState.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';
import { runFetchApplicantPdfs } from '../crawler/resume/fetchApplicantPdfsBatch.js';
import { env } from '../config/env.js';

function parseLimit(): number | undefined {
  const idx = process.argv.indexOf('--limit');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const fromEnv = Number(process.env.PDF_MAX_ITEMS || '');
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return undefined;
}

async function main(): Promise<void> {
  assertScheduledAutomationAllowed('pdf:applicants');
  process.env.CRAWL_FETCH_RESUMES = 'true';
  process.env.HEADLESS = process.env.HEADLESS || 'true';

  const onlyRef = process.argv.find((a) => a.startsWith('--ref='))?.split('=')[1];
  const repairInvalid = process.argv.includes('--repair') || Boolean(onlyRef);
  const limit = parseLimit() ?? Math.min(env.crawlMaxItems(), 15);

  try {
    const result = await runFetchApplicantPdfs({
      onlyRef,
      repairInvalid,
      limit,
    });
    console.log(
      `[pdf:applicants] saved=${result.saved} failed=${result.failed} remain=${result.remaining} targets=${result.targets}`,
    );
    if (result.targets === 0) {
      console.log('[pdf:applicants] 대상 없음 — 즉시 종료');
      return;
    }
    if (result.saved > 0) markSessionOk('jobkorea');
    if (result.failed > 0 || result.remaining > 0) {
      process.exitCode = result.saved === 0 && result.targets > 0 ? 1 : 0;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pdf:applicants] ${message}`);
    process.exitCode = 1;
    const auth = await handleAuthFailure({ err, platform: 'jobkorea' });
    if (auth.handledAsAuth) return;
    try {
      await sendOpsAlert(
        '[TBELL] 지원자 PDF 배치 실패',
        `<p>Playwright PDF 수집이 실패했습니다.</p><p><b>원인:</b> ${message.replace(/</g, '&lt;')}</p>`,
      );
    } catch (mailErr) {
      console.error('[pdf:applicants] 알림 메일 실패:', mailErr);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
