import type { Page } from 'playwright';
import type { NormalizedApplicant, NormalizedTalent, Platform } from '../db/types.js';

export type NavAction = 'click' | 'type' | 'wait' | 'hover' | 'scroll' | 'iframe_switch';

export interface NavStep {
  action: NavAction;
  target?: string; // selectors 키 참조
  value?: string;  // type 액션용 값 또는 wait(ms)
}

export interface PaginationConfig {
  strategy: 'click_next' | 'scroll' | 'none';
  next_selector?: string;
}

export interface RouteDef {
  url?: string;
  ready_selector?: string;
  path_from_home?: NavStep[];
  pagination?: PaginationConfig;
}

export interface LoginConfig {
  url: string;
  success_selector: string;
  session_expired_selector?: string;
  fields: { username: string; password: string };
  submit: string;
}

export interface RouteMap {
  platform: Platform;
  version: string;
  login: LoginConfig;
  routes: Record<string, RouteDef>;
  selectors: Record<string, string>;
}

export interface CrawlContext {
  page: Page;
  routeMap: RouteMap;
  jobId: string;
  platform: Platform;
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
    step?: string,
  ) => Promise<void>;
}

/** 모든 사이트 커넥터가 구현해야 하는 표준 인터페이스 */
export interface Connector {
  readonly platform: Platform;
  login(ctx: CrawlContext, creds: { username: string; password: string; totpSecret?: string }): Promise<{
    ok: boolean;
    reason?: string;
  }>;
  crawlApplicants(ctx: CrawlContext): Promise<NormalizedApplicant[]>;
  crawlTalentPool(ctx: CrawlContext): Promise<NormalizedTalent[]>;
  healthCheck(ctx: CrawlContext): Promise<'ok' | 'warn' | 'fail'>;
}
