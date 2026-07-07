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
      await page.goto(login.url, { waitUntil: 'domcontentloaded' });
      await page.fill(resolveSelector(routeMap, login.fields.username), creds.username);
      await page.fill(resolveSelector(routeMap, login.fields.password), creds.password);
      await page.click(resolveSelector(routeMap, login.submit));

      const successSel = resolveSelector(routeMap, login.success_selector);
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
