import type { CrawlContext, NavStep, RouteDef } from './types.js';
import { resolveSelector } from './routeMap.js';

/**
 * Route Map 기반 이동 엔진.
 * 설정 파일의 단계(step)를 순서대로 실행하고 ready_selector 로 성공을 판정한다.
 * 실패 시 어느 단계/셀렉터에서 실패했는지 예외 메시지에 포함한다.
 */
export class Navigator {
  constructor(private readonly ctx: CrawlContext) {}

  /** 지정 route 로 이동. url 이 있으면 직접 이동, 없으면 home 기준 step 실행. */
  async goto(routeName: string): Promise<void> {
    const { routeMap, page } = this.ctx;
    const route: RouteDef | undefined = routeMap.routes[routeName];
    if (!route) throw new Error(`route 미정의: ${routeName}`);

    await this.ctx.log('info', `이동 시작: ${routeName}`, undefined, 'navigate');

    if (route.url) {
      await page.goto(route.url, { waitUntil: 'domcontentloaded' });
    } else if (route.path_from_home) {
      const home = routeMap.routes['home'];
      if (home?.url) await page.goto(home.url, { waitUntil: 'domcontentloaded' });
      await this.runSteps(route.path_from_home);
    }

    if (route.ready_selector) {
      const sel = resolveSelector(routeMap, route.ready_selector);
      try {
        await page.waitForSelector(sel, { timeout: 15_000 });
      } catch {
        throw new Error(
          `route '${routeName}' ready_selector 대기 실패: ${route.ready_selector} (${sel})`,
        );
      }
    }

    await this.ctx.log('info', `이동 완료: ${routeName}`, undefined, 'navigate');
  }

  /** step 목록 순차 실행 */
  async runSteps(steps: NavStep[]): Promise<void> {
    const { routeMap, page } = this.ctx;
    for (const [i, step] of steps.entries()) {
      const sel = step.target ? resolveSelector(routeMap, step.target) : undefined;
      try {
        switch (step.action) {
          case 'click':
            await page.click(sel!);
            break;
          case 'type':
            await page.fill(sel!, step.value ?? '');
            break;
          case 'hover':
            await page.hover(sel!);
            break;
          case 'scroll':
            await page.mouse.wheel(0, 1200);
            break;
          case 'wait':
            await page.waitForTimeout(Number(step.value ?? 500));
            break;
          case 'iframe_switch':
            // iframe 진입은 커넥터에서 frameLocator 로 별도 처리
            break;
          default:
            throw new Error(`알 수 없는 action: ${step.action}`);
        }
      } catch (err) {
        throw new Error(
          `step[${i}] ${step.action}(${step.target ?? ''}) 실패: ${(err as Error).message}`,
        );
      }
    }
  }

  /** 페이지네이션: 다음 페이지로 이동. 더 이상 없으면 false. */
  async next(routeName: string): Promise<boolean> {
    const { routeMap, page } = this.ctx;
    const route = routeMap.routes[routeName];
    const pg = route?.pagination;
    if (!pg || pg.strategy === 'none') return false;

    if (pg.strategy === 'scroll') {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(800);
      return true;
    }

    if (pg.strategy === 'click_next' && pg.next_selector) {
      const sel = resolveSelector(routeMap, pg.next_selector);
      const el = await page.$(sel);
      if (!el) return false;
      const disabled = await el.getAttribute('disabled');
      if (disabled !== null) return false;
      await el.click();
      await page.waitForTimeout(800);
      return true;
    }
    return false;
  }
}
