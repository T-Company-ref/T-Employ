import { existsSync, rmSync } from 'node:fs';
import type { Platform } from '../db/types.js';
import { closePool } from '../db/client.js';
import { sendOpsAlert } from '../mail/alerts.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';
import { refreshPlatformSession } from '../crawler/http/refreshSessionOnce.js';
import { sessionStatePath } from '../crawler/http/sessionCookies.js';
import { markSessionRefreshed } from '../crawler/session/authState.js';

const ALIAS = 'tbell-corp';

/**
 * Playwright로 재로그인 후 storageState 저장.
 * 성공 시 인증 오류 상태(중복 메일 플래그) 초기화.
 *
 * usage:
 *   npm run session:refresh
 *   npm run session:refresh -- jobkorea
 */
async function main(): Promise<void> {
  assertScheduledAutomationAllowed('session:refresh');
  process.env.HEADLESS = process.env.HEADLESS || 'true';

  const platform = (process.argv[2] ?? 'jobkorea') as Platform;
  const notifyOk = process.argv.includes('--notify-ok');
  const path = sessionStatePath(platform, ALIAS);

  if (existsSync(path)) {
    rmSync(path, { force: true });
    console.log(`[refresh-session] 기존 세션 삭제: ${path}`);
  }

  try {
    const res = await refreshPlatformSession(platform, { clearExisting: false });
    markSessionRefreshed(platform);
    console.log(`[refresh-session] ${platform} 세션 갱신 완료 → ${res.path}`);
    if (notifyOk) {
      await sendOpsAlert(
        `[TBELL] 세션 갱신 성공 · ${platform}`,
        `<p>플랫폼 <b>${platform}</b> storageState 갱신 완료. 인증 오류 상태가 초기화되었습니다.</p>
         <p>Actions → 실패한 poll/crawl 을 다시 실행하세요.</p>`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[refresh-session] 실패: ${message}`);
    process.exitCode = 1;
    try {
      await sendOpsAlert(
        `[TBELL] 세션 갱신 실패 · ${platform}`,
        `<p>플랫폼 <b>${platform}</b> 로그인/세션 저장에 실패했습니다.</p>
         <p><b>원인:</b> ${message.replace(/</g, '&lt;')}</p>
         <p>CAPTCHA·추가 인증이 필요하면 로컬에서 <code>npm run dev:session</code> 을 확인하세요.</p>`,
      );
    } catch (mailErr) {
      console.error('[refresh-session] 실패 알림 메일 오류:', mailErr);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
