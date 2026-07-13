import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { env } from '../config/env.js';
import type { Platform } from '../db/types.js';
import { loadRouteMap } from '../crawler/routeMap.js';
import { openSession } from '../crawler/browser.js';
import { getConnector, registeredPlatforms } from '../crawler/connectors/index.js';
import { Navigator } from '../crawler/navigator.js';
import type { CrawlContext } from '../crawler/types.js';

const ARTIFACT_DIR = resolve(process.cwd(), 'artifacts');

/** 2단계 인증/추가 본인확인 페이지로 리다이렉트되었는지 판단 */
function isTwoFactorPage(url: string): boolean {
  return /company-viewer\/certification|\/certification|access-verification|two-?factor|\/otp/i.test(
    url,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 2단계 인증 페이지에 걸리면 사용자가 직접 인증을 완료할 때까지 대기한다.
 * 인증 완료(= 인증 URL 이탈) 시 true. 제한 시간 초과 시 false.
 */
async function waitForTwoFactor(page: Page, timeoutMs = 10 * 60_000): Promise<boolean> {
  console.log('\n  ============================================================');
  console.log('  [2단계 인증 필요] 브라우저 창에서 직접 인증을 완료해 주세요.');
  console.log('    - 사람인: 휴대폰(SMS) 또는 이메일로 인증번호 요청 후 입력');
  console.log('    - 인증은 6개월간 유효하며, 완료 후 세션이 저장되어 재사용됩니다.');
  console.log('  인증이 끝나면 자동으로 다음 단계로 진행합니다...');
  console.log('  ============================================================\n');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(3000);
    if (!isTwoFactorPage(page.url())) {
      console.log('  [2단계 인증] 완료 감지됨. 계속 진행합니다.');
      return true;
    }
  }
  console.log('  [2단계 인증] 제한 시간 초과.');
  return false;
}

/** 진단용: 현재 페이지 HTML/URL/title 을 artifacts 에 저장 */
async function dumpPage(page: Page, platform: string, stage: string): Promise<void> {
  try {
    if (!existsSync(ARTIFACT_DIR)) mkdirSync(ARTIFACT_DIR, { recursive: true });
    const html = await page.content();
    const file = resolve(ARTIFACT_DIR, `${platform}_${stage}.html`);
    writeFileSync(file, html, 'utf8');
    console.log(`  [dump] url=${page.url()} title="${await page.title()}" -> ${file}`);
  } catch (err) {
    console.log(`  [dump] 실패(${stage}): ${(err as Error).message}`);
  }
}

/**
 * 로그인 + 라우트 진입 스모크 테스트 (DB 미접근).
 * 실제 기업계정 자격증명(.env)이 있을 때 "로그인 후 셀렉터 확정" 작업을 돕는다.
 *
 * 사용법:
 *   HEADLESS=false npm run dev:login            # 등록된 전체 플랫폼
 *   HEADLESS=false npm run dev:login -- jobkorea # 특정 플랫폼
 *
 * 각 라우트 진입 성공/실패와 스크린샷 경로를 출력한다. DB 에는 아무것도 쓰지 않는다.
 */

async function checkPlatform(
  platform: Platform,
  dumpOnly: boolean,
  waitTwoFa: boolean,
): Promise<boolean> {
  console.log(`\n=== [${platform}] 로그인/라우트 점검${dumpOnly ? ' (덤프 전용)' : ''} ===`);
  const creds = env.platformCreds(platform);
  if (!dumpOnly && (!creds.username || !creds.password)) {
    console.log(`  건너뜀: 자격증명 없음 (${platform.toUpperCase()}_USERNAME/PASSWORD 미설정)`);
    return false;
  }

  const routeMap = loadRouteMap(platform);
  const connector = getConnector(platform);
  const session = await openSession(platform);

  const ctx: CrawlContext = {
    page: session.page,
    routeMap,
    jobId: 'login-check',
    platform,
    log: async (level, message) => {
      console.log(`  [${level}] ${message}`);
    },
  };

  let allOk = true;
  try {
    // 로그인 페이지 DOM 을 먼저 확보 (필드 셀렉터 확정용)
    await session.page.goto(routeMap.login.url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await dumpPage(session.page, platform, 'login_page');

    // 덤프 전용: 자격증명 제출 없이 로그인 페이지 DOM 만 확보 (기업/개인 탭·셀렉터 발굴용)
    if (dumpOnly) {
      console.log('  덤프 전용 모드: 로그인 시도 없이 종료');
      return true;
    }

    const login = await connector.login(ctx, creds);
    // 성공 판정 셀렉터가 아직 미확정이어도 로그인 이후 DOM 을 확보 (선택자 발굴용)
    await session.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await dumpPage(session.page, platform, 'after_login');
    await session.screenshot('after_login').catch(() => null);
    if (!login.ok) {
      console.log(`  로그인 실패(성공판정 미확정 가능): ${login.reason ?? 'unknown'}`);
      return false;
    }
    console.log('  로그인 성공');
    await session.saveSession();

    const nav = new Navigator(ctx);
    for (const route of ['applicants_list', 'talent_pool_list']) {
      if (!routeMap.routes[route]) continue;
      try {
        await nav.goto(route);
        // 2단계 인증 페이지에 걸리면 사용자 인증을 기다린 뒤 세션 저장
        if (isTwoFactorPage(session.page.url())) {
          if (waitTwoFa) {
            const done = await waitForTwoFactor(session.page);
            if (done) {
              await session.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
              await session.saveSession();
              console.log('  [세션 저장] 2단계 인증 쿠키 포함 세션을 저장했습니다.');
            } else {
              allOk = false;
            }
          } else {
            allOk = false;
            console.log(
              `  라우트 보류: ${route} -> 2단계 인증 필요. 'npm run dev:session -- ${platform}' 로 1회 인증하세요.`,
            );
          }
        }
        const shot = await session.screenshot(`route_${route}`).catch(() => null);
        await dumpPage(session.page, platform, `route_${route}`);
        console.log(`  라우트 OK: ${route}${shot ? ` (screenshot: ${shot})` : ''}`);
      } catch (err) {
        allOk = false;
        const shot = await session.screenshot(`route_${route}_fail`).catch(() => null);
        await dumpPage(session.page, platform, `route_${route}_fail`);
        console.log(`  라우트 실패: ${route} -> ${(err as Error).message}${shot ? ` (screenshot: ${shot})` : ''}`);
      }
    }
  } finally {
    await session.close();
  }
  return allOk;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).map((a) => a.trim());
  const dumpOnly = args.includes('--dump-only');
  const waitTwoFa = args.includes('--wait-2fa');
  // 2단계 인증은 사람이 직접 입력해야 하므로 창을 띄운다
  if (waitTwoFa) process.env.HEADLESS = 'false';
  const arg = args.find((a) => !a.startsWith('--'));
  const targets = arg
    ? [arg as Platform]
    : (registeredPlatforms() as Platform[]);

  if (env.headless()) {
    console.log('참고: HEADLESS=true 입니다. 셀렉터를 눈으로 확인하려면 HEADLESS=false 로 실행하세요.');
  }

  let ok = true;
  for (const platform of targets) {
    const res = await checkPlatform(platform, dumpOnly, waitTwoFa).catch((err) => {
      console.error(`  오류: ${(err as Error).message}`);
      return false;
    });
    ok = ok && res;
  }

  console.log(
    ok
      ? '\n결과: 모든 대상 로그인/라우트 진입 성공.'
      : '\n결과: 일부 실패 — 스크린샷과 Route Map(config/routes/*.yaml) 셀렉터를 확인하세요.',
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
