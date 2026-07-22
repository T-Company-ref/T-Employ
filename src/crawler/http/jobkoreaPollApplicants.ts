import { env } from '../../config/env.js';
import type { NormalizedApplicant } from '../../db/types.js';
import type { PostingNavItem } from '../extract/jobkorea.js';
import { collectApplicantsFromPostings } from '../extract/jobkorea.js';
import { openSession } from '../browser.js';
import { loadRouteMap } from '../routeMap.js';
import { fetchJobkoreaHtml, type FetchHtmlResult } from './jobkoreaFetch.js';
import {
  openPlaywrightFetchSession,
  shouldUsePlaywrightFetch,
  type PlaywrightFetchSession,
} from './jobkoreaFetchPlaywright.js';
import {
  parseApplicantListHtml,
  parseApplicantPaging,
  parsePostingListHtml,
  parsePostingPaging,
} from './jobkoreaHtmlParse.js';
import { loadSessionCookieHeader } from './sessionCookies.js';

const BASE = 'https://www.jobkorea.co.kr';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PollApplicantsResult = {
  postings: number;
  applicants: NormalizedApplicant[];
  sessionPath: string;
};

/** Actions 는 request HTML 로 지원자 행이 비는 경우가 많아 Chromium 사용 */
export function shouldUseBrowserPoll(): boolean {
  if (process.env.POLL_USE_BROWSER === 'true') return true;
  if (process.env.POLL_USE_BROWSER === 'false') return false;
  return Boolean(process.env.GITHUB_ACTIONS);
}

async function pollWithBrowser(limit: number): Promise<PollApplicantsResult> {
  const { path, cookieCount } = loadSessionCookieHeader('jobkorea');
  console.log(`[poll] session ${path} cookies=${cookieCount} mode=playwright-browser`);
  const routeMap = loadRouteMap('jobkorea');
  const session = await openSession('jobkorea');
  try {
    await session.page.goto(`${BASE}/Corp/GIMng/List?PubType=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    const applicants = await collectApplicantsFromPostings(session.page, routeMap, limit);
    await session.saveSession();
    if (applicants.length === 0) {
      throw new Error(
        'POLL_EMPTY_APPLICANTS: 브라우저 폴링에서도 지원자 0명 — 세션/권한 문제 가능',
      );
    }
    return { postings: -1, applicants, sessionPath: path };
  } finally {
    await session.close().catch(() => undefined);
  }
}

type HtmlGetter = (url: string, options?: { referer?: string }) => Promise<FetchHtmlResult>;

async function collectAllPostings(getHtml: HtmlGetter): Promise<PostingNavItem[]> {
  const all: PostingNavItem[] = [];
  const seen = new Set<string>();

  for (const pubType of ['1', '2']) {
    let page = 1;
    for (;;) {
      const url =
        page === 1
          ? `${BASE}/Corp/GIMng/List?PubType=${pubType}`
          : `${BASE}/Corp/GIMng/List?PubType=${pubType}&Page=${page}`;
      const { html } = await getHtml(url, { referer: `${BASE}/Corp/Main` });
      const batch = parsePostingListHtml(html);
      for (const p of batch) {
        if (seen.has(p.giNo)) continue;
        seen.add(p.giNo);
        all.push(p);
      }
      const paging = parsePostingPaging(html);
      if (!paging.hasNext || batch.length === 0) break;
      page = paging.nextPage;
      await sleep(400);
    }
  }

  return all;
}

async function collectApplicantsForPosting(
  getHtml: HtmlGetter,
  posting: PostingNavItem,
  remaining: number,
  options?: { maxPages?: number },
): Promise<NormalizedApplicant[]> {
  if (remaining <= 0) return [];

  const out: NormalizedApplicant[] = [];
  const seen = new Set<string>();
  let page = 1;
  const maxPages = options?.maxPages ?? 12;
  const listBase = `${BASE}/Corp/Applicant/list?GI_No=${posting.giNo}&PageCode=YA`;

  for (;;) {
    if (page > maxPages) break;
    const url = page === 1 ? listBase : `${listBase}&Page=${page}`;

    const { html } = await getHtml(url, {
      referer: `${BASE}/Corp/GIMng/List?PubType=1`,
    });
    if (page === 1 && !html.includes('data-pssno')) {
      const tip = html.includes('Login') ? 'login?' : `html=${html.length}B`;
      console.warn(`[poll] empty applicant html GI_No=${posting.giNo} ${tip}`);
    }
    const batch = parseApplicantListHtml(html, posting);
    let added = 0;
    for (const item of batch) {
      if (seen.has(item.externalRef)) continue;
      seen.add(item.externalRef);
      out.push(item);
      added += 1;
      if (out.length >= remaining) return out;
    }

    const paging = parseApplicantPaging(html);
    if (!paging.hasNext || added === 0) break;
    if (!batch.length) break;
    page = paging.nextPage;
    await sleep(350);
  }

  return out;
}

async function pollWithHttp(limit: number): Promise<PollApplicantsResult> {
  const { path, cookieHeader, cookieCount } = loadSessionCookieHeader('jobkorea');
  const usePw = shouldUsePlaywrightFetch();
  console.log(
    `[poll] session ${path} cookies=${cookieCount} mode=${usePw ? 'playwright-request' : 'undici-fetch'}`,
  );

  let pw: PlaywrightFetchSession | null = null;
  const getHtml: HtmlGetter = async (url, opts) => {
    if (pw) return pw.get(url, opts);
    return fetchJobkoreaHtml(url, cookieHeader, opts);
  };

  try {
    if (usePw) pw = await openPlaywrightFetchSession();

    const postings = await collectAllPostings(getHtml);
    console.log(`[poll] postings ${postings.length}`);

    const applicants: NormalizedApplicant[] = [];
    const seen = new Set<string>();

    const pushBatch = (batch: NormalizedApplicant[]) => {
      for (const item of batch) {
        if (seen.has(item.externalRef)) continue;
        seen.add(item.externalRef);
        applicants.push(item);
        if (applicants.length >= limit) return true;
      }
      return applicants.length >= limit;
    };

    for (const posting of postings) {
      if (applicants.length >= limit) break;
      const batch = await collectApplicantsForPosting(
        getHtml,
        posting,
        Math.min(30, limit - applicants.length),
        { maxPages: 1 },
      );
      const full = pushBatch(batch);
      console.log(
        `[poll] p1 GI_No=${posting.giNo} +${batch.length} total=${applicants.length} "${posting.title.slice(0, 40)}"`,
      );
      if (full) break;
      await sleep(250);
    }

    if (applicants.length < limit) {
      for (const posting of postings) {
        if (applicants.length >= limit) break;
        const batch = await collectApplicantsForPosting(
          getHtml,
          posting,
          limit - applicants.length,
          { maxPages: 12 },
        );
        const before = applicants.length;
        pushBatch(batch);
        const gained = applicants.length - before;
        if (gained > 0) {
          console.log(
            `[poll] p2 GI_No=${posting.giNo} +${gained} total=${applicants.length} "${posting.title.slice(0, 40)}"`,
          );
        }
        await sleep(250);
      }
    }

    if (postings.length > 0 && applicants.length === 0) {
      throw new Error(
        'POLL_EMPTY_APPLICANTS: 공고는 보이나 지원자 0명 — 세션 만료/지원자 목록 파싱 실패 가능. npm run session:refresh 후 재시도',
      );
    }

    return { postings: postings.length, applicants, sessionPath: path };
  } finally {
    await pw?.close().catch(() => undefined);
  }
}

/**
 * 지원자 폴링.
 * - 로컬: HTTP(undici) 또는 Playwright request
 * - Actions: Chromium 브라우저 (지원자 목록이 request HTML 에 안 실히는 문제 회피)
 */
export async function pollJobkoreaApplicants(options?: {
  limit?: number;
}): Promise<PollApplicantsResult> {
  const limit = options?.limit ?? env.crawlMaxItems();
  if (shouldUseBrowserPoll()) {
    return pollWithBrowser(limit);
  }
  return pollWithHttp(limit);
}
