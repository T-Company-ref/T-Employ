import { buildDailyReport } from '../db/repositories/reporting.js';
import { query, closePool } from '../db/client.js';
import { env } from '../config/env.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';

/**
 * 전일 데이터 집계 및 요약 메일 큐 등록.
 * cron 없이 workflow_dispatch / CLI 수동 실행.
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
  assertScheduledAutomationAllowed('report:compose');

  const report = await buildDailyReport();
  const html = renderReportHtml(report);
  const recipients = env.dailyReportRecipients();
  const subject = `[TBELL Employ] ${report.date} 지원 현황 요약`;

  await query(
    `INSERT INTO mail_jobs (mail_type, template_id, recipients, subject, body_html, status, scheduled_at)
     VALUES ('daily_report', 'daily-summary', $1, $2, $3, 'queued', now())`,
    [recipients, subject, html],
  );

  console.log('[report:compose] 요약 생성·메일 큐 등록 완료');
  console.log('  수신자:', recipients.join(', '));
  console.log('  신규 지원:', report.newApplicants, '/ 인재:', report.newTalents);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
