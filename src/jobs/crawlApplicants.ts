import { getEnabledPlatforms } from '../db/repositories/platform.js';
import { runPlatform, type RunResult } from '../crawler/runner.js';
import { closePool } from '../db/client.js';

/**
 * 매일 18:00 KST: 활성 플랫폼을 우선순위 순서로 순차 수집(공고 지원자).
 * 특정 플랫폼만 실행하려면 인자로 platform 전달: `tsx crawlApplicants.ts jobkorea`
 */
async function main(): Promise<void> {
  const only = process.argv[2];
  const configs = await getEnabledPlatforms();
  const targets = only ? configs.filter((c) => c.platform === only) : configs;

  if (targets.length === 0) {
    console.warn('[crawl:applicants] 대상 플랫폼이 없습니다.');
    return;
  }

  const results: RunResult[] = [];
  for (const cfg of targets) {
    console.log(`[crawl:applicants] ${cfg.platform} 시작`);
    const res = await runPlatform('applicants', cfg.platform);
    results.push(res);
    console.log(`[crawl:applicants] ${cfg.platform} 결과:`, res);
  }

  console.table(results);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
