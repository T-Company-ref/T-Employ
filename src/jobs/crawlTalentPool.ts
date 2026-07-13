import { runCrawlBatch } from './crawlBatch.js';
import { closePool } from '../db/client.js';

/**
 * 인재검색/포지션 제안 후보 수집.
 * Phase 2: cron 18:20 KST + 세션 재사용/재시도/ crawl_window.
 */
async function main(): Promise<void> {
  const only = process.argv[2] || undefined;
  const results = await runCrawlBatch('crawl:talent', 'talent_pool', only);
  if (results.length > 0) console.table(results);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
