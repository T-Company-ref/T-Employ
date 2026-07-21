import * as cheerio from 'cheerio';
import type {
  ApplicantProfileMeta,
  NormalizedApplicant,
  PostingMeta,
} from '../../db/types.js';
import { parseJobkoreaDate } from '../extract/jobkorea.js';
import type { PostingNavItem } from '../extract/jobkorea.js';

const BASE = 'https://www.jobkorea.co.kr';

type CheerioRoot = cheerio.CheerioAPI;
type CheerioEl = ReturnType<CheerioRoot>;

function absUrl(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  return href.startsWith('http') ? href : `${BASE}${href}`;
}

function text(el: CheerioEl): string {
  return el.first().text().replace(/\s+/g, ' ').trim();
}

function collectTexts($: CheerioRoot, selector: string, ctx?: CheerioEl): string[] {
  const found = ctx ? ctx.find(selector) : $(selector);
  const out: string[] = [];
  found.each((_, node) => {
    const t = $(node).text().replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  });
  return out;
}

function one($: CheerioRoot, selector: string, ctx?: CheerioEl): string {
  const found = ctx ? ctx.find(selector) : $(selector);
  return text(found);
}

/** 공고 관리 HTML → 공고 목록 */
export function parsePostingListHtml(html: string): PostingNavItem[] {
  const $ = cheerio.load(html);
  const results: PostingNavItem[] = [];

  $('.giListItem').each((_, node) => {
    const item = $(node);
    const titleLink = item.find('a.tit.devLinkExpire').first();
    const href = titleLink.attr('href') ?? null;
    const giMatch = href?.match(/GI_No=(\d+)/i);
    const giNo = giMatch?.[1];
    if (!giNo) return;

    const title = text(titleLink) || '(제목 없음)';
    const status = one($, 'em.used, .used', item);
    const postingNumber = one($, '.tbDate .date span', item);
    const manager = one($, '.tbDate .mday', item);
    const periodText = text(item.find('.tbDate .date').eq(1));
    const viewHref = item.find('a[href*="/Recruit/GI_Read/"]').first().attr('href') ?? null;
    const gno =
      item.find('[data-gno]').first().attr('data-gno') ||
      viewHref?.match(/GI_Read\/(\d+)/i)?.[1] ||
      postingNumber;

    const applicantListUrl = absUrl(href) ?? `${BASE}/Corp/Applicant/list?GI_No=${giNo}&PageCode=YA`;

    const counts: Record<string, number> = {};
    item.find('.apyStatusBoard .boardItem').each((__, bi) => {
      const board = $(bi);
      const label = one($, '.stepTit', board);
      const num = Number(one($, 'a.itemNum', board));
      if (label && !Number.isNaN(num)) counts[label] = num;
    });

    const meta: PostingMeta = {
      postingNumber: gno ?? postingNumber,
      giNo,
      status: status || undefined,
      manager: manager || undefined,
      period: periodText ? periodText.replace(/\s+/g, ' ').trim() : undefined,
      viewUrl: absUrl(viewHref),
      applicantListUrl,
      applicantCounts: Object.keys(counts).length ? counts : undefined,
    };

    results.push({ giNo, title, meta });
  });

  return results;
}

/** 공고 목록 페이징 */
export function parsePostingPaging(html: string): {
  current: number;
  hasNext: boolean;
  nextPage: number;
} {
  const $ = cheerio.load(html);
  const currentText = one($, '.tplPagination.newVer .now') || '1';
  const current = Number(currentText.trim()) || 1;
  const next = $(`.tplPagination.newVer a[data-page-no="${current + 1}"]`);
  return { current, hasNext: next.length > 0, nextPage: current + 1 };
}

/** 지원자 목록 HTML → 정규화 레코드 */
export function parseApplicantListHtml(
  html: string,
  posting?: PostingNavItem,
): NormalizedApplicant[] {
  const $ = cheerio.load(html);
  const results: NormalizedApplicant[] = [];

  $('tr[data-pssno]').each((_, node) => {
    const row = $(node);
    const externalRef = row.attr('data-pssno');
    if (!externalRef) return;

    const name = one($, '.applicant-box .name', row) || undefined;
    const genderParts = collectTexts($, '.applicant-box .line-list li', row);
    const gender = genderParts[0];
    const age = genderParts.find((t) => t.includes('세')) ?? genderParts[1];
    const recommendTags = collectTexts($, '.keyword-list li', row);
    const position = one($, 'td:nth-child(3) a.devTypeAplctHref', row) || undefined;

    const eduCell = row.find('td').eq(4);
    const educationLevel = one($, '.strong', eduCell) || undefined;
    const eduNormals = collectTexts($, '.normal', eduCell);
    const educationSchool = eduNormals[0];
    const educationMajor = eduNormals[1];

    const careerCell = row.find('td').eq(5);
    const careerTotal = one($, '.strong', careerCell) || undefined;
    const careerHistory = collectTexts($, '.normal', careerCell);

    const desiredSalary = text(row.find('td').eq(6)) || undefined;
    const appliedAtText = one($, 'td .date', row);
    const readStatus = one($, '.read, .txReadNew', row) || undefined;
    const detailHref = row.find('a.devTypeAplctHref').first().attr('href') ?? null;

    const profileMeta: ApplicantProfileMeta = {
      position,
      gender,
      age,
      genderAge: genderParts.join(', ') || undefined,
      recommendTags: recommendTags.length ? recommendTags : undefined,
      educationLevel,
      educationSchool,
      educationMajor,
      careerTotal,
      careerHistory: careerHistory.length ? careerHistory : undefined,
      desiredSalary,
      readStatus,
      platformStatus: readStatus,
      detailUrl: absUrl(detailHref),
    };

    results.push({
      platform: 'jobkorea',
      externalRef,
      name,
      appliedAt: parseJobkoreaDate(appliedAtText),
      postingExternalId: posting?.giNo,
      postingTitle: posting?.title,
      postingMeta: posting?.meta,
      profileMeta,
      stage: 'applied',
    });
  });

  return results;
}

export function parseApplicantPaging(html: string): {
  current: number;
  hasNext: boolean;
  nextPage: number;
} {
  const $ = cheerio.load(html);
  const currentText = one($, '#dev_viewpageing .now, #dev_viewpageing .current') || '1';
  const current = Number(currentText.trim()) || 1;
  const next = $(`#dev_viewpageing a[data-page-no="${current + 1}"]`);
  return { current, hasNext: next.length > 0, nextPage: current + 1 };
}

export function countApplicantRows(html: string): number {
  const $ = cheerio.load(html);
  return $('tr[data-pssno]').length;
}
