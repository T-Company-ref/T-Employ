import { BaseConnector } from './base.js';
import type { CrawlContext } from '../types.js';
import type { NormalizedApplicant, NormalizedTalent } from '../../db/types.js';
import { env } from '../../config/env.js';
import { resolveSelector } from '../routeMap.js';
import {
  collectApplicantsFromPostings,
  collectPaginated,
  clickNextTalentPage,
  extractTalentPage,
} from '../extract/jobkorea.js';
import { fetchApplicantResumeViaPopup, fetchJobkoreaResumePdf } from '../resume/jobkoreaResume.js';

/**
 * 잡코리아 커넥터.
 * 공고 관리(GIMng) → 공고별 지원자, 인재검색 순으로 수집한다.
 */
export class JobkoreaConnector extends BaseConnector {
  readonly platform = 'jobkorea';

  async crawlApplicants(ctx: CrawlContext): Promise<NormalizedApplicant[]> {
    const nav = this.nav(ctx);
    await nav.goto('postings_list');
    await ctx.page.waitForSelector(resolveSelector(ctx.routeMap, 'posting_item'), {
      timeout: 20_000,
    });
    await this.assertAuthenticated(ctx);
    await ctx.log('info', '공고 관리(전체 채용공고) 진입', undefined, 'goto_postings');

    const limit = env.crawlMaxItems();
    const results = await collectApplicantsFromPostings(ctx.page, ctx.routeMap, limit);

    if (env.crawlFetchResumes() && results.length > 0) {
      let remaining = Math.min(results.length, 5);
      const rowSel = resolveSelector(ctx.routeMap, 'applicant_row');
      const byRef = new Map(results.map((r) => [r.externalRef, r]));

      for (const postingId of [...new Set(results.map((r) => r.postingExternalId).filter(Boolean))]) {
        if (remaining <= 0) break;
        const sample = results.find((r) => r.postingExternalId === postingId);
        const url =
          sample?.postingMeta?.applicantListUrl ??
          `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${postingId}&PageCode=YA`;
        await ctx.page.goto(url, { waitUntil: 'domcontentloaded' });
        await ctx.page.waitForSelector(rowSel, { timeout: 15_000 }).catch(() => undefined);

        const rows = ctx.page.locator(rowSel);
        const n = await rows.count();
        for (let i = 0; i < n && remaining > 0; i++) {
          const row = rows.nth(i);
          const ref = await row.getAttribute('data-pssno');
          const rec = ref ? byRef.get(ref) : undefined;
          if (!rec || rec.resumePdf) continue;

          const pdf = await fetchApplicantResumeViaPopup(ctx.page, ctx.routeMap, row);
          if (pdf) rec.resumePdf = pdf;
          await ctx.log(
            'info',
            `지원자 이력서 PDF ${pdf ? `저장(${pdf.length}B)` : '스킵'}`,
            { ref, name: rec.name },
            'resume',
          );
          remaining -= 1;
        }
      }
    }

    await ctx.log('info', `지원자 수집 완료: ${results.length}건`, { limit }, 'collect');
    return results;
  }

  async crawlTalentPool(ctx: CrawlContext): Promise<NormalizedTalent[]> {
    const nav = this.nav(ctx);
    await nav.goto('talent_pool_list');
    await ctx.page.waitForSelector(resolveSelector(ctx.routeMap, 'talent_row'), {
      timeout: 20_000,
    });
    await this.assertAuthenticated(ctx);
    await ctx.log('info', '인재검색 목록 진입 완료', undefined, 'goto_list');

    const limit = env.crawlMaxItems();
    const results = await collectPaginated(
      () => extractTalentPage(ctx.page, ctx.routeMap, limit),
      () => clickNextTalentPage(ctx.page, ctx.routeMap),
      (r) => r.profileRef,
      limit,
    );

    if (env.crawlFetchResumes()) {
      const fetchLimit = Math.min(results.length, 8);
      for (let i = 0; i < fetchLimit; i++) {
        const rec = results[i];
        if (!rec.profileUrl || rec.resumePdf) continue;
        const pdf = await fetchJobkoreaResumePdf(ctx.page, ctx.routeMap, rec.profileUrl, 'talent');
        if (pdf) rec.resumePdf = pdf;
        await ctx.log(
          'info',
          `인재 이력서 PDF ${pdf ? `저장(${pdf.length}B)` : '스킵'}`,
          { ref: rec.profileRef },
          'resume',
        );
      }
    }

    await ctx.log('info', `인재검색 수집 완료: ${results.length}건`, { limit }, 'collect');
    return results;
  }
}
