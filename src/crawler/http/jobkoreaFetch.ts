const BASE = 'https://www.jobkorea.co.kr';

export class SessionExpiredError extends Error {
  constructor(message = 'SESSION_EXPIRED') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export type FetchHtmlResult = {
  url: string;
  status: number;
  html: string;
};

function looksLikeLoginPage(html: string, finalUrl: string): boolean {
  if (/\/Login/i.test(finalUrl)) return true;
  if (/id=["']M_ID["']/i.test(html) && /id=["']M_PWD["']/i.test(html)) return true;
  if (/로그인/.test(html) && /기업회원/.test(html) && /M_ID/.test(html)) return true;
  return false;
}

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? `${err.cause.name} ${err.cause.message}`
      : '';
  const text = `${msg} ${cause}`.toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('socket') ||
    text.includes('aborted') ||
    text.includes('network')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Location 헤더를 절대 URL로 */
function resolveLocation(fromUrl: string, location: string | null): string | null {
  if (!location) return null;
  try {
    return new URL(location, fromUrl).toString();
  } catch {
    return null;
  }
}

/**
 * 세션 쿠키로 HTML GET.
 * - redirect 수동 추적(최대 8) — 무한 리다이렉트/로그인 페이지를 SessionExpired 로 분류
 * - 일시 네트워크 오류 재시도
 */
export async function fetchJobkoreaHtml(
  pathOrUrl: string,
  cookieHeader: string,
  options: { timeoutMs?: number; referer?: string; retries?: number } = {},
): Promise<FetchHtmlResult> {
  const startUrl = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const retries = options.retries ?? 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(startUrl, cookieHeader, options);
    } catch (err) {
      lastErr = err;
      if (err instanceof SessionExpiredError) throw err;
      if (!isTransientNetworkError(err) || attempt >= retries) throw err;
      console.warn(
        `[fetch] transient retry ${attempt + 1}/${retries}: ${err instanceof Error ? err.message : err}` +
          (err instanceof Error && err.cause instanceof Error ? ` cause=${err.cause.message}` : ''),
      );
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchOnce(
  startUrl: string,
  cookieHeader: string,
  options: { timeoutMs?: number; referer?: string },
): Promise<FetchHtmlResult> {
  const maxRedirects = 8;
  let url = startUrl;
  let referer = options.referer ?? `${BASE}/Corp/Main`;
  const seen = new Set<string>();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (seen.has(url)) {
      throw new SessionExpiredError(`redirect_loop:${url}`);
    }
    seen.add(url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Cookie: cookieHeader,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Referer: referer,
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const next = resolveLocation(url, res.headers.get('location'));
        if (!next) throw new Error(`HTTP_${res.status}_no_location:${url}`);
        if (/\/Login/i.test(next)) {
          throw new SessionExpiredError(`login_redirect:${next}`);
        }
        referer = url;
        url = next;
        continue;
      }

      const html = await res.text();
      if (looksLikeLoginPage(html, url)) {
        throw new SessionExpiredError(`login_page:${url}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SessionExpiredError(`HTTP_${res.status}:${url}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP_${res.status}:${url}`);
      }
      return { url, status: res.status, html };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new SessionExpiredError(`redirect_count_exceeded:${startUrl}`);
}
