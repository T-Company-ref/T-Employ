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

/** 세션 쿠키로 HTML 페이지 GET */
export async function fetchJobkoreaHtml(
  pathOrUrl: string,
  cookieHeader: string,
  options: { timeoutMs?: number; referer?: string } = {},
): Promise<FetchHtmlResult> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Cookie: cookieHeader,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: options.referer ?? `${BASE}/Corp/Main`,
      },
    });

    const html = await res.text();
    const finalUrl = res.url || url;

    if (looksLikeLoginPage(html, finalUrl)) {
      throw new SessionExpiredError(`login_page:${finalUrl}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SessionExpiredError(`HTTP_${res.status}:${finalUrl}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP_${res.status}:${finalUrl}`);
    }

    return { url: finalUrl, status: res.status, html };
  } finally {
    clearTimeout(timeout);
  }
}
