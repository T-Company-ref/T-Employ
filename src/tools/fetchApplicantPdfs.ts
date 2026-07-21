/**
 * PDF 없거나 손상된 잡코리아 지원자 이력서를 팝업 인쇄로 수집 (dev 도구).
 * 운영 스케줄은 `npm run pdf:applicants` 를 사용한다.
 *
 * usage:
 *   npm run dev:fetch-pdfs
 *   npm run dev:fetch-pdfs -- --repair
 *   npm run dev:fetch-pdfs -- --ref=438636484
 */
import { closePool } from '../db/client.js';
import { runFetchApplicantPdfs } from '../crawler/resume/fetchApplicantPdfsBatch.js';

async function main() {
  process.env.CRAWL_FETCH_RESUMES = 'true';
  process.env.HEADLESS = process.env.HEADLESS || 'true';

  const onlyRef = process.argv.find((a) => a.startsWith('--ref='))?.split('=')[1];
  const repairInvalid = process.argv.includes('--repair') || Boolean(onlyRef);

  const result = await runFetchApplicantPdfs({ onlyRef, repairInvalid });
  console.log(
    `[fetch-pdf] 완료 saved=${result.saved} failed=${result.failed} remain=${result.remaining}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
