import { request, type APIRequestContext } from 'playwright';
import { SessionExpiredError, type FetchHtmlResult } from './jobkoreaFetch.js';
import { sessionStatePath } from './sessionCookies.js';

const BASE = 'https://www.jobkorea.co.kr';

function looksLikeLoginPage(html: string, finalUrl: string): boolean {
  if (/\/Login/i.test(finalUrl)) return true;
  if (/id=["']M_ID["']/i.test(html) && /id=["']M_PWD["']/i.test(html)) return true;
  if (/로그인/.test(html) && /기업회원/.test(html) && /M_ID/.test(html)) return true;
  return false;
}

export type PlaywrightFetchSession = {
  get: (url: string, options?: { referer?: string; timeoutMs?: number }) => Promise<FetchHtmlResult>;
  close: () => Promise<void>;
};

/** 폴링 1회 동안 재사용할 Playwright request 세션 */
export async function openPlaywrightFetchSession(): Promise<PlaywrightFetchSession> {
  const statePath = sessionStatePath('jobkorea');
  const ctx: APIRequestContext = await request.newContext({
    storageState: statePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });

  return {
    async get(pathOrUrl, options = {}) {
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
      const res = await ctx.get(url, {
        maxRedirects: 8,
        timeout: options.timeoutMs ?? 30_000,
        headers: {
          Referer: options.referer ?? `${BASE}/Corp/Main`,
        },
      });
      const finalUrl = res.url();
      const html = await res.text();

      if (looksLikeLoginPage(html, finalUrl)) {
        throw new SessionExpiredError(`login_page:${finalUrl}`);
      }
      if (res.status() === 401 || res.status() === 403) {
        throw new SessionExpiredError(`HTTP_${res.status()}:${finalUrl}`);
      }
      if (!res.ok()) {
        throw new Error(`HTTP_${res.status()}:${finalUrl}`);
      }
      return { url: finalUrl, status: res.status(), html };
    },
    async close() {
      await ctx.dispose().catch(() => undefined);
    },
  };
}

/** Actions 또는 POLL_USE_PLAYWRIGHT=true 이면 Playwright request 사용 */
export function shouldUsePlaywrightFetch(): boolean {
  if (process.env.POLL_USE_PLAYWRIGHT === 'true') return true;
  if (process.env.POLL_USE_PLAYWRIGHT === 'false') return false;
  return Boolean(process.env.GITHUB_ACTIONS);
}
