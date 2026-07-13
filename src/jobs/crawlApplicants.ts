import { runCrawlBatch } from './crawlBatch.js';
import { closePool } from '../db/client.js';

/**
 * 공고 지원자 수집.
 * Phase 2: cron 18:00 KST + 세션 재사용/재시도/ crawl_window.
 */
async function main(): Promise<void> {
  const only = process.argv[2] || undefined;
  const results = await runCrawlBatch('crawl:applicants', 'applicants', only);
  if (results.length > 0) console.table(results);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
