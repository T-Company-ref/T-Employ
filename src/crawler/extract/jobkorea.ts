import type { Locator, Page } from 'playwright';
import type { RouteMap } from '../types.js';
import type {
  ApplicantProfileMeta,
  NormalizedApplicant,
  NormalizedTalent,
  PostingMeta,
  TalentProfileMeta,
} from '../../db/types.js';
import { resolveSelector } from '../routeMap.js';

/** 잡코리아 지원일 표기(yy.mm.dd) → ISO date */
export function parseJobkoreaDate(text: string | null | undefined): string {
  const raw = (text ?? '').trim();
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return new Date().toISOString();
  const year = 2000 + Number(m[1]);
  return `${year}-${m[2]}-${m[3]}T00:00:00.000Z`;
}

export interface PostingNavItem {
  giNo: string;
  title: string;
  meta: PostingMeta;
}

const BASE = 'https://www.jobkorea.co.kr';

function absUrl(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  return href.startsWith('http') ? href : `${BASE}${href}`;
}

/** 공고 관리 > 진행중 목록에서 공고 카드 파싱 */
export async function extractPostingList(page: Page): Promise<PostingNavItem[]> {
  const items = page.locator('.giListItem');
  const count = await items.count();
  const results: PostingNavItem[] = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const titleLink = item.locator('a.tit.devLinkExpire').first();
    const href = await titleLink.getAttribute('href');
    const giMatch = href?.match(/GI_No=(\d+)/i);
    const giNo = giMatch?.[1];
    if (!giNo) continue;

    const title = (await titleLink.textContent())?.trim() || '(제목 없음)';
    const status = (await item.locator('em.used, .used').first().textContent())?.trim();
    const postingNumber = (
      await item.locator('.tbDate .date span').first().textContent()
    )?.trim();
    const manager = (await item.locator('.tbDate .mday').first().textContent())?.trim();
    const periodText = (await item.locator('.tbDate .date').nth(1).textContent())?.trim();

    const viewHref = await item.locator('a[href*="/Recruit/GI_Read/"]').first().getAttribute('href');
    const gno =
      (await item.locator('[data-gno]').first().getAttribute('data-gno')) ||
      viewHref?.match(/GI_Read\/(\d+)/i)?.[1] ||
      postingNumber;

    const applicantListUrl = `${BASE}/Corp/Applicant/list?GI_No=${giNo}&PageCode=YA`;

    const counts: Record<string, number> = {};
    const countLinks = item.locator('.apyStatusBoard .boardItem a.itemNum');
    const countLabels = item.locator('.apyStatusBoard .boardItem .stepTit');
    const labelN = await countLabels.count();
    for (let j = 0; j < labelN; j++) {
      const label = ((await countLabels.nth(j).textContent()) ?? '').trim();
      const numText = ((await countLinks.nth(j).textContent()) ?? '').trim();
      const num = Number(numText);
      if (label && !Number.isNaN(num)) counts[label] = num;
    }

    const meta: PostingMeta = {
      postingNumber: gno ?? postingNumber,
      giNo,
      status,
      manager,
      period: periodText?.replace(/\s+/g, ' ').trim(),
      viewUrl: absUrl(viewHref),
      applicantListUrl,
      applicantCounts: Object.keys(counts).length ? counts : undefined,
    };

    results.push({ giNo, title, meta });
  }

  return results;
}

/** 공고 목록 다음 페이지 */
export async function clickNextPostingPage(page: Page, routeMap: RouteMap): Promise<boolean> {
  const pagingSel = resolveSelector(routeMap, 'posting_paging');
  const currentText = await page.locator(`${pagingSel} .now`).first().textContent();
  const current = Number((currentText ?? '1').trim()) || 1;
  const next = page.locator(`${pagingSel} a[data-page-no="${current + 1}"]`);
  if ((await next.count()) === 0) return false;
  await next.first().click();
  await page.waitForTimeout(1200);
  await page.waitForSelector(resolveSelector(routeMap, 'posting_item'), { timeout: 15_000 });
  return true;
}

/** 지원자 테이블 행 파싱 (v2 UI) */
export async function extractApplicantPage(
  page: Page,
  routeMap: RouteMap,
  posting?: PostingNavItem,
): Promise<NormalizedApplicant[]> {
  const rowSel = resolveSelector(routeMap, 'applicant_row');
  const rows = page.locator(rowSel);
  const count = await rows.count();

  const results: NormalizedApplicant[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const externalRef = await row.getAttribute('data-pssno');
    if (!externalRef) continue;

    const safeText = async (loc: Locator) =>
      (await loc.textContent({ timeout: 2_000 }).catch(() => null))?.trim() || undefined;
    const safeAll = async (loc: Locator) =>
      (await loc.allTextContents({ timeout: 2_000 }).catch(() => [])).map((t) => t.trim()).filter(Boolean);

    const name = await safeText(row.locator('.applicant-box .name'));
    const genderParts = await safeAll(row.locator('.applicant-box .line-list li'));
    const gender = genderParts[0];
    const age = genderParts.find((t) => t.includes('세')) ?? genderParts[1];
    const recommendTags = await safeAll(row.locator('.keyword-list li'));
    const position = await safeText(row.locator('td').nth(2).locator('a.devTypeAplctHref').first());

    const eduCell = row.locator('td').nth(4);
    const educationLevel = await safeText(eduCell.locator('.strong').first());
    const eduNormals = await safeAll(eduCell.locator('.normal'));
    const educationSchool = eduNormals[0];
    const educationMajor = eduNormals[1];

    const careerCell = row.locator('td').nth(5);
    const careerTotal = await safeText(careerCell.locator('.strong').first());
    const careerHistory = await safeAll(careerCell.locator('.normal'));

    const desiredSalary = await safeText(row.locator('td').nth(6));
    const appliedAtText = await safeText(row.locator('td .date').first());
    const readStatus = await safeText(row.locator('.read, .txReadNew').first());
    const detailHref = await row
      .locator('a.devTypeAplctHref')
      .first()
      .getAttribute('href')
      .catch(() => null);

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
      platform: routeMap.platform,
      externalRef,
      name,
      appliedAt: parseJobkoreaDate(appliedAtText),
      postingExternalId: posting?.giNo,
      postingTitle: posting?.title,
      postingMeta: posting?.meta,
      profileMeta,
      stage: 'applied',
    });
  }
  return results;
}

function cleanTalentText(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b화살표\b/g, '')
    .replace(/[▶►▸▹➔➜➝➞➡⇒⟶→←↑↓]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned || cleaned === '경력사항' || cleaned === '학력사항') return undefined;
  return cleaned;
}

/** 현재 페이지의 인재검색 행을 카드 단위로 파싱한다. */
export async function extractTalentPage(
  page: Page,
  routeMap: RouteMap,
  maxRows = 50,
): Promise<NormalizedTalent[]> {
  const rowSel = resolveSelector(routeMap, 'talent_row');
  const rows = page.locator(rowSel);
  const count = Math.min(await rows.count(), Math.max(1, maxRows));
  const sourcedAt = new Date().toISOString();

  const results: NormalizedTalent[] = [];
  const rowMs = 5_000;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const profileRef = await row.getAttribute('data-rno', { timeout: rowMs }).catch(() => null);
    if (!profileRef) continue;

    const textOf = async (selector: string) =>
      row.locator(selector).first().textContent({ timeout: rowMs }).catch(() => null);
    const textsOf = async (selector: string) =>
      row.locator(selector).allTextContents({ timeout: rowMs }).catch(() => [] as string[]);

    // strong 만 쓰면 화살표 span 이 섞이지 않음. 없으면 title 텍스트에서 노이즈 제거
    const headlineStrong = (await textOf('.tdSummary .title strong'))?.trim();
    const headlineRaw = headlineStrong || (await textOf('.tdSummary .title'))?.trim();
    const headline = cleanTalentText(headlineRaw);

    const name = cleanTalentText(await textOf('.nameAge dt, .devName'));
    const genderAge = cleanTalentText(await textOf('.nameAge dd, .devAge'));
    const careerText = cleanTalentText(await textOf('.careerLayer dd, .devCareerYear'));
    const companyRaw = (await textOf('.careerLayer dt, .companyName, .devCareerCo'))?.trim();
    const company = cleanTalentText(companyRaw);

    const roles = (await textsOf('.careerLayer .item, .devCareerItem, .jobList li, .devPart'))
      .map((t) => cleanTalentText(t))
      .filter((t): t is string => Boolean(t));

    const skills = (await textsOf('.keywordBox button, .keywordBox a, .devKeyword'))
      .map((t) => cleanTalentText(t))
      .filter((t): t is string => Boolean(t));

    const badges = (await textsOf('.hashTagArea a, .hashTagArea span, .devHashTag, .badgeList span'))
      .map((t) => cleanTalentText(t))
      .filter((t): t is string => Boolean(t));

    const jobStatus = cleanTalentText(
      await textOf(
        '.hopeTxt, .jobState, .devJobState, .wishType, .tplStat, .stat, dd:has-text("구직"), dd:has-text("재직"), dd:has-text("취업")',
      ),
    );

    const href = await row
      .locator('a.dvResumeLink, a[href*="Resume"]')
      .first()
      .getAttribute('href', { timeout: rowMs })
      .catch(() => null);

    const profileMeta: TalentProfileMeta = {
      genderAge: genderAge || undefined,
      careerText: careerText || undefined,
      company: company || undefined,
      roles: roles.length ? roles : undefined,
      skills: skills.length ? skills : undefined,
      badges: badges.length ? badges : undefined,
      jobStatus: jobStatus || undefined,
    };

    const summaryParts = [
      careerText,
      company,
      roles.slice(0, 4).join(', '),
      skills.slice(0, 6).join(', '),
    ].filter(Boolean);

    results.push({
      platform: routeMap.platform,
      profileRef,
      profileUrl: absUrl(href),
      name: name || undefined,
      headline: headline || undefined,
      summaryText: summaryParts.join(' · ') || undefined,
      profileMeta,
      sourcedAt,
    });
  }
  return results;
}

export async function clickNextApplicantPage(page: Page, routeMap: RouteMap): Promise<boolean> {
  const pagingSel = resolveSelector(routeMap, 'applicant_paging');
  const currentText = await page
    .locator(`${pagingSel} .now, ${pagingSel} .current`)
    .first()
    .textContent();
  const current = Number((currentText ?? '1').trim()) || 1;
  const next = page.locator(`${pagingSel} a[data-page-no="${current + 1}"]`);
  if ((await next.count()) === 0) return false;
  await next.first().click();
  await page.waitForTimeout(1200);
  await page.waitForSelector(resolveSelector(routeMap, 'applicant_row'), { timeout: 15_000 });
  return true;
}

export async function clickNextTalentPage(page: Page, routeMap: RouteMap): Promise<boolean> {
  const pagingSel = resolveSelector(routeMap, 'talent_paging');
  const currentText = await page
    .locator(`${pagingSel} .current, ${pagingSel} .now`)
    .first()
    .textContent();
  const current = Number((currentText ?? '1').trim()) || 1;
  const next = page.locator(`${pagingSel} a[data-page-no="${current + 1}"]`);
  if ((await next.count()) === 0) return false;
  await next.first().click();
  await page.waitForTimeout(1200);
  await page.waitForSelector(resolveSelector(routeMap, 'talent_row'), { timeout: 15_000 });
  return true;
}

/** 공고 관리 → 공고별 지원자 수집 */
export async function collectApplicantsFromPostings(
  page: Page,
  routeMap: RouteMap,
  limit: number,
): Promise<NormalizedApplicant[]> {
  const rowSel = resolveSelector(routeMap, 'applicant_row');
  const out: NormalizedApplicant[] = [];
  const seen = new Set<string>();

  const allPostings: PostingNavItem[] = [];
  const postingSeen = new Set<string>();

  for (const pubType of ['1', '2']) {
    await page.goto(`${BASE}/Corp/GIMng/List?PubType=${pubType}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    const hasList = await page
      .waitForSelector('.giListItem', { timeout: 12_000 })
      .catch(() => null);
    if (!hasList) continue;

    for (;;) {
      for (const posting of await extractPostingList(page)) {
        if (postingSeen.has(posting.giNo)) continue;
        postingSeen.add(posting.giNo);
        allPostings.push(posting);
      }
      const hasNext = await clickNextPostingPage(page, routeMap);
      if (!hasNext) break;
    }
  }

  console.log(`[browser-poll] postings ${allPostings.length}`);

  // Pass 1: 각 공고 1페이지 (신규 누락 방지)
  for (const posting of allPostings) {
    if (out.length >= limit) break;
    const url = `${BASE}/Corp/Applicant/list?GI_No=${posting.giNo}&PageCode=YA`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const hasRows = await page
      .locator(rowSel)
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    if (!hasRows) {
      console.log(`[browser-poll] p1 GI_No=${posting.giNo} +0`);
      continue;
    }

    const pageItems = await extractApplicantPage(page, routeMap, posting);
    let added = 0;
    for (const item of pageItems) {
      if (seen.has(item.externalRef)) continue;
      seen.add(item.externalRef);
      out.push(item);
      added += 1;
      if (out.length >= limit) break;
    }
    console.log(
      `[browser-poll] p1 GI_No=${posting.giNo} +${added} total=${out.length} "${posting.title.slice(0, 40)}"`,
    );
  }

  // Pass 2: 남은 quota 로 페이지네이션
  if (out.length < limit) {
    for (const posting of allPostings) {
      if (out.length >= limit) break;
      const url = `${BASE}/Corp/Applicant/list?GI_No=${posting.giNo}&PageCode=YA`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const hasRows = await page
        .locator(rowSel)
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (!hasRows) continue;

      const before = out.length;
      const batch = await collectPaginated(
        () => extractApplicantPage(page, routeMap, posting),
        () => clickNextApplicantPage(page, routeMap),
        (r) => r.externalRef,
        limit - out.length,
      );
      for (const item of batch) {
        if (seen.has(item.externalRef)) continue;
        seen.add(item.externalRef);
        out.push(item);
        if (out.length >= limit) break;
      }
      const gained = out.length - before;
      if (gained > 0) {
        console.log(
          `[browser-poll] p2 GI_No=${posting.giNo} +${gained} total=${out.length}`,
        );
      }
    }
  }

  return out.slice(0, limit);
}

/** @deprecated use collectApplicantsFromPostings */
export async function collectApplicantsAcrossPostings(
  page: Page,
  routeMap: RouteMap,
  limit: number,
): Promise<NormalizedApplicant[]> {
  return collectApplicantsFromPostings(page, routeMap, limit);
}

export async function collectPaginated<T extends { externalRef?: string; profileRef?: string }>(
  extractPage: () => Promise<T[]>,
  clickNext: () => Promise<boolean>,
  key: (item: T) => string,
  limit: number,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();

  for (;;) {
    let added = 0;
    for (const item of await extractPage()) {
      const id = key(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      added += 1;
      if (out.length >= limit) return out;
    }
    if (out.length >= limit) break;
    const hasNext = await clickNext();
    if (!hasNext || added === 0) break;
  }
  return out;
}

/** 지원자 이름 클릭 → 이력서 상세 → PDF (리스트 복귀) */
export async function fetchApplicantResumeFromRow(
  page: Page,
  routeMap: RouteMap,
  row: Locator,
): Promise<Buffer | null> {
  const listUrl = page.url();
  try {
    const link = row.locator('a.applicant-box.devTypeAplctHref, .applicant-box').first();
    await link.click({ timeout: 8_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
    await page.waitForTimeout(800);

    const blocked = await page
      .locator('text=비정상적인 경로')
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (blocked) {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      return null;
    }

    const { fetchJobkoreaResumePdf } = await import('../resume/jobkoreaResume.js');
    const pdf = await Promise.race([
      fetchJobkoreaResumePdf(page, routeMap, page.url(), 'applicant'),
      new Promise<null>((r) => setTimeout(() => r(null), 25_000)),
    ]);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    return pdf;
  } catch {
    if (page.url() !== listUrl) {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
    }
    return null;
  }
}
