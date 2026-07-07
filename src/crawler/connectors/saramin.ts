import { BaseConnector } from './base.js';
import type { CrawlContext } from '../types.js';
import type { NormalizedApplicant, NormalizedTalent } from '../../db/types.js';

/**
 * 사람인 커넥터.
 * 로그인 후 [지원자 관리] 및 [인재풀] 경로로 이동하여 수집한다.
 */
export class SaraminConnector extends BaseConnector {
  readonly platform = 'saramin';

  async crawlApplicants(ctx: CrawlContext): Promise<NormalizedApplicant[]> {
    const nav = this.nav(ctx);
    await nav.goto('applicants_list');
    await ctx.log('info', '지원자 목록 진입 완료', undefined, 'goto_list');

    const results: NormalizedApplicant[] = [];
    // TODO(Phase 1): applicant_table 행 파싱
    await ctx.log('info', `지원자 수집 완료: ${results.length}건`, undefined, 'collect');
    return results;
  }

  async crawlTalentPool(ctx: CrawlContext): Promise<NormalizedTalent[]> {
    const nav = this.nav(ctx);
    await nav.goto('talent_pool_list');
    await ctx.log('info', '인재풀 목록 진입 완료', undefined, 'goto_list');

    const results: NormalizedTalent[] = [];
    // TODO(Phase 1): talent_card 파싱
    await ctx.log('info', `인재풀 수집 완료: ${results.length}건`, undefined, 'collect');
    return results;
  }
}
