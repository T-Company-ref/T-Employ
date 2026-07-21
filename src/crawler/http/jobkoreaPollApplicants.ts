import { env } from '../../config/env.js';
import type { NormalizedApplicant } from '../../db/types.js';
import type { PostingNavItem } from '../extract/jobkorea.js';
import { fetchJobkoreaHtml } from './jobkoreaFetch.js';
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

async function collectAllPostings(cookieHeader: string): Promise<PostingNavItem[]> {
  const all: PostingNavItem[] = [];
  const seen = new Set<string>();
  let page = 1;

  for (;;) {
    const url =
      page === 1
        ? `${BASE}/Corp/GIMng/List?PubType=1`
        : `${BASE}/Corp/GIMng/List?PubType=1&Page=${page}`;
    const { html } = await fetchJobkoreaHtml(url, cookieHeader, {
      referer: `${BASE}/Corp/Main`,
    });
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

  return all;
}

async function collectApplicantsForPosting(
  cookieHeader: string,
  posting: PostingNavItem,
  remaining: number,
): Promise<NormalizedApplicant[]> {
  if (remaining <= 0) return [];

  const out: NormalizedApplicant[] = [];
  const seen = new Set<string>();
  let page = 1;
  const listBase =
    posting.meta.applicantListUrl ??
    `${BASE}/Corp/Applicant/list?GI_No=${posting.giNo}&PageCode=YA`;

  for (;;) {
    const url =
      page === 1
        ? listBase
        : listBase.includes('?')
          ? `${listBase}&Page=${page}`
          : `${listBase}?Page=${page}`;

    const { html } = await fetchJobkoreaHtml(url, cookieHeader, {
      referer: `${BASE}/Corp/GIMng/List?PubType=1`,
    });
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
    page = paging.nextPage;
    await sleep(350);
  }

  return out;
}

/**
 * Playwright 없이 storageState 쿠키로 지원자 목록 수집.
 * PDF는 수집하지 않는다 (Phase B에서 분리).
 */
export async function pollJobkoreaApplicants(options?: {
  limit?: number;
}): Promise<PollApplicantsResult> {
  const limit = options?.limit ?? env.crawlMaxItems();
  const { path, cookieHeader, cookieCount } = loadSessionCookieHeader('jobkorea');
  console.log(`[poll] session ${path} cookies=${cookieCount}`);

  const postings = await collectAllPostings(cookieHeader);
  console.log(`[poll] postings ${postings.length}`);

  const applicants: NormalizedApplicant[] = [];
  const seen = new Set<string>();

  for (const posting of postings) {
    if (applicants.length >= limit) break;
    const batch = await collectApplicantsForPosting(
      cookieHeader,
      posting,
      limit - applicants.length,
    );
    for (const item of batch) {
      if (seen.has(item.externalRef)) continue;
      seen.add(item.externalRef);
      applicants.push(item);
      if (applicants.length >= limit) break;
    }
    console.log(
      `[poll] GI_No=${posting.giNo} +${batch.length} total=${applicants.length} "${posting.title.slice(0, 40)}"`,
    );
    await sleep(300);
  }

  return { postings: postings.length, applicants, sessionPath: path };
}
