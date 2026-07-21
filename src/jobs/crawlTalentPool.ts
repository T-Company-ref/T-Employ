import { runCrawlBatch } from './crawlBatch.js';
import { closePool } from '../db/client.js';
import { sendOpsAlert } from '../mail/alerts.js';
import { handleAuthFailure } from '../mail/sessionAuthAlert.js';
import { markSessionOk } from '../crawler/session/authState.js';

/**
 * 인재검색 후보 수집 (Playwright — 하루 1회).
 * 세션 만료 시 자동 갱신 없음 → 관리자 메일 + session-refresh 수동.
 */
async function main(): Promise<void> {
  process.env.HEADLESS = process.env.HEADLESS || 'true';
  const platformArg = process.argv[2] || undefined;

  try {
    const results = await runCrawlBatch('crawl:talent', 'talent_pool', platformArg);
    if (results.length > 0) console.table(results);

    const failed = results.filter((r) => r.error && !r.skipped);
    let authHandled = false;
    for (const f of failed) {
      const auth = await handleAuthFailure({
        err: new Error(f.error || 'unknown'),
        platform: f.platform as 'jobkorea',
      });
      if (auth.handledAsAuth) authHandled = true;
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      if (!authHandled) {
        await sendOpsAlert(
          `[TBELL] 인재 크롤 실패 · ${failed.map((f) => f.platform).join(', ')}`,
          `<ul>${failed
            .map((f) => `<li><b>${f.platform}</b>: ${(f.error || '').replace(/</g, '&lt;')}</li>`)
            .join('')}</ul>`,
        );
      }
    } else {
      markSessionOk('jobkorea');
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    const auth = await handleAuthFailure({ err, platform: 'jobkorea' });
    if (!auth.handledAsAuth) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await sendOpsAlert('[TBELL] 인재 크롤 실패', `<p>${message.replace(/</g, '&lt;')}</p>`);
      } catch (mailErr) {
        console.error('[crawl:talent] 알림 메일 실패:', mailErr);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
