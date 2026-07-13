import type { Connector, CrawlContext } from '../types.js';
import type { NormalizedApplicant, NormalizedTalent, Platform } from '../../db/types.js';
import { Navigator } from '../navigator.js';
import { resolveSelector } from '../routeMap.js';

/**
 * 공통 커넥터 베이스.
 * login/healthCheck 는 Route Map 기반 공통 구현을 제공하고,
 * 사이트별 수집 파싱(crawlApplicants/crawlTalentPool)만 하위 클래스가 구현한다.
 */
export abstract class BaseConnector implements Connector {
  abstract readonly platform: Platform;

  protected nav(ctx: CrawlContext): Navigator {
    return new Navigator(ctx);
  }

  protected async assertAuthenticated(ctx: CrawlContext): Promise<void> {
    const key = ctx.routeMap.login.session_expired_selector;
    if (!key) return;
    const sel = resolveSelector(ctx.routeMap, key);
    const onLogin = await ctx.page
      .locator(sel)
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (onLogin) {
      throw new Error('session_expired: login form detected');
    }
  }

  async login(
    ctx: CrawlContext,
    creds: { username: string; password: string; totpSecret?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    const { page, routeMap } = ctx;
    const login = routeMap.login;

    if (!creds.username || !creds.password) {
      return { ok: false, reason: 'credentials_missing' };
    }

    try {
      const successSel = resolveSelector(routeMap, login.success_selector);
      const homeUrl = routeMap.routes.home?.url;

      // 저장된 세션이 유효하면 로그인 폼 없이 홈 진입
      if (homeUrl) {
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
        const sessionOk = await page
          .locator(successSel)
          .first()
          .isVisible({ timeout: 5_000 })
          .catch(() => false);
        if (sessionOk) {
          await ctx.log('info', '세션 재사용(로그인 생략)', undefined, 'login');
          return { ok: true };
        }
      }

      await page.goto(login.url, { waitUntil: 'domcontentloaded' });

      // 로그인 전 사전 단계 (예: 기업회원 탭 전환)
      if (login.pre_steps?.length) {
        const tabSel = login.pre_steps.find((s) => s.target === 'corp_login_tab')
          ? resolveSelector(routeMap, 'corp_login_tab')
          : null;
        if (tabSel) {
          const tabVisible = await page.locator(tabSel).first().isVisible({ timeout: 3_000 }).catch(() => false);
          if (tabVisible) {
            await this.nav(ctx).runSteps(login.pre_steps);
          }
        } else {
          await this.nav(ctx).runSteps(login.pre_steps);
        }
      }

      await page.fill(resolveSelector(routeMap, login.fields.username), creds.username);
      await page.fill(resolveSelector(routeMap, login.fields.password), creds.password);
      await page.click(resolveSelector(routeMap, login.submit));

      await page.waitForSelector(successSel, { timeout: 15_000 });
      await ctx.log('info', '로그인 성공', undefined, 'login');
      return { ok: true };
    } catch (err) {
      await ctx.log('error', '로그인 실패', { error: (err as Error).message }, 'login');
      return { ok: false, reason: (err as Error).message };
    }
  }

  async healthCheck(ctx: CrawlContext): Promise<'ok' | 'warn' | 'fail'> {
    try {
      await this.nav(ctx).goto('home');
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  abstract crawlApplicants(ctx: CrawlContext): Promise<NormalizedApplicant[]>;
  abstract crawlTalentPool(ctx: CrawlContext): Promise<NormalizedTalent[]>;
}
