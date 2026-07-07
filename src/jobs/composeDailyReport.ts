import { buildDailyReport } from '../db/repositories/reporting.js';
import { query, closePool } from '../db/client.js';
import { env } from '../config/env.js';

/**
 * 매일 07:50 KST: 전일 데이터를 집계하여 요약 본문을 생성하고,
 * mail_jobs 에 발송 대기(queued) 작업으로 등록한다.
 */
export function renderReportHtml(report: Awaited<ReturnType<typeof buildDailyReport>>): string {
  const rows = report.byPlatform
    .map(
      (p) =>
        `<tr><td>${p.platform}</td><td style="text-align:right">${p.applicants}</td><td style="text-align:right">${p.talents}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html lang="ko"><body style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
  <h2 style="color:#16a34a">TBELL Employ 일일 요약 (${report.date})</h2>
  <ul>
    <li>신규 지원자: <b>${report.newApplicants}</b>건</li>
    <li>신규 인재검색 후보: <b>${report.newTalents}</b>건</li>
    <li>당일 면접 일정: <b>${report.interviewsToday}</b>건</li>
    <li>상태 변경: <b>${report.statusChanges}</b>건</li>
    <li>추천 태그 추가: <b>${report.recommendationsAdded}</b>건</li>
  </ul>
  <h3>플랫폼별 현황</h3>
  <table border="1" cellpadding="6" style="border-collapse:collapse">
    <thead><tr><th>플랫폼</th><th>지원자</th><th>인재검색</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </body></html>`;
}

async function main(): Promise<void> {
  const report = await buildDailyReport();
  const html = renderReportHtml(report);
  const recipients = env.dailyReportRecipients();
  const subject = `[TBELL Employ] ${report.date} 지원 현황 요약`;

  await query(
    `INSERT INTO mail_jobs (mail_type, template_id, recipients, subject, status, scheduled_at)
     VALUES ('daily_report', 'daily-summary', $1, $2, 'queued', now())`,
    [recipients, subject],
  );

  // 본문은 발송 잡에서 다시 생성하거나, 여기서 파일/스토리지 보관 가능
  console.log('[report:compose] 요약 생성 완료');
  console.log(html.slice(0, 200) + ' ...');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
