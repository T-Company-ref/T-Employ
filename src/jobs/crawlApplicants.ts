import { runCrawlBatch } from './crawlBatch.js';
import { closePool } from '../db/client.js';
import { sendApplicantCrawlResultMail } from '../mail/crawlResult.js';
import type { RunResult } from '../crawler/runner.js';
import type { Platform } from '../db/types.js';

/**
 * 공고 지원자 수집.
 * 완료(또는 실패) 후 운영자에게 결과 메일을 발송한다.
 */
async function main(): Promise<void> {
  const only = process.argv[2] || undefined;
  let results: RunResult[] = [];

  try {
    results = await runCrawlBatch('crawl:applicants', 'applicants', only);
    if (results.length > 0) console.table(results);
  } catch (err) {
    results = [
      {
        platform: (only as Platform) || 'jobkorea',
        error: (err as Error).message,
      },
    ];
    process.exitCode = 1;
    console.error(err);
  }

  try {
    await sendApplicantCrawlResultMail(results);
  } catch (mailErr) {
    console.error('[crawl:applicants] 결과 메일 실패:', mailErr);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
