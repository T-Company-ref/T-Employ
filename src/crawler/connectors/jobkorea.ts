import { BaseConnector } from './base.js';
import type { CrawlContext } from '../types.js';
import type { NormalizedApplicant, NormalizedTalent } from '../../db/types.js';

/**
 * 잡코리아 커넥터.
 * 로그인 후 [지원자 관리] 및 [인재검색/포지션 제안] 경로로 이동하여 수집한다.
 *
 * NOTE: 목록/상세 파싱 셀렉터는 Route Map(config/routes/jobkorea.yaml)의
 * selectors 를 실제 사이트 확인 후 채운 뒤 아래 extract 로직을 완성한다.
 */
export class JobkoreaConnector extends BaseConnector {
  readonly platform = 'jobkorea';

  async crawlApplicants(ctx: CrawlContext): Promise<NormalizedApplicant[]> {
    const nav = this.nav(ctx);
    await nav.goto('applicants_list');
    await ctx.log('info', '지원자 목록 진입 완료', undefined, 'goto_list');

    const results: NormalizedApplicant[] = [];
    // TODO(Phase 1): applicant_table 행을 순회하며 필드 추출
    //   const rows = await ctx.page.$$(resolveSelector(ctx.routeMap, 'applicant_table') + ' tr');
    //   for (const row of rows) { ... results.push({ platform, externalRef, ... }) }
    // 페이지네이션: while (await nav.next('applicants_list')) { ... }

    await ctx.log('info', `지원자 수집 완료: ${results.length}건`, undefined, 'collect');
    return results;
  }

  async crawlTalentPool(ctx: CrawlContext): Promise<NormalizedTalent[]> {
    const nav = this.nav(ctx);
    await nav.goto('talent_pool_list');
    await ctx.log('info', '인재검색 목록 진입 완료', undefined, 'goto_list');

    const results: NormalizedTalent[] = [];
    // TODO(Phase 1): talent_card 를 순회하며 프로필 추출
    await ctx.log('info', `인재검색 수집 완료: ${results.length}건`, undefined, 'collect');
    return results;
  }
}
