import { getEnabledPlatforms } from '../db/repositories/platform.js';
import { runPlatform, type RunResult } from '../crawler/runner.js';
import { closePool } from '../db/client.js';

/**
 * 매일 18:20 KST: 활성 플랫폼을 우선순위 순서로 순차 수집(인재검색/포지션 제안).
 */
async function main(): Promise<void> {
  const only = process.argv[2];
  const configs = await getEnabledPlatforms();
  const targets = only ? configs.filter((c) => c.platform === only) : configs;

  if (targets.length === 0) {
    console.warn('[crawl:talent] 대상 플랫폼이 없습니다.');
    return;
  }

  const results: RunResult[] = [];
  for (const cfg of targets) {
    console.log(`[crawl:talent] ${cfg.platform} 시작`);
    const res = await runPlatform('talent_pool', cfg.platform);
    results.push(res);
    console.log(`[crawl:talent] ${cfg.platform} 결과:`, res);
  }

  console.table(results);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
