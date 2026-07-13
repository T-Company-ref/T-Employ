import { query, closePool } from '../db/client.js';
import { renderReportHtml } from './composeDailyReport.js';
import { buildDailyReport } from '../db/repositories/reporting.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';
import { sendHtmlMail } from '../mail/transport.js';
import { sendOpsAlert } from '../mail/alerts.js';

interface MailJobRow {
  id: string;
  recipients: string[];
  subject: string;
  body_html: string | null;
  attempt_count: number;
}

const MAX_ATTEMPTS = 3;

/**
 * queued/retry 상태 daily_report 메일 발송 + 실패 시 재시도·운영자 경고.
 * cron 없이 workflow_dispatch / CLI 수동 실행.
 */
async function main(): Promise<void> {
  assertScheduledAutomationAllowed('mail:send');

  const pending = await query<MailJobRow>(
    `SELECT id, recipients, subject, body_html, attempt_count
     FROM mail_jobs
     WHERE mail_type = 'daily_report' AND status IN ('queued', 'retry')
     ORDER BY created_at ASC`,
  );

  if (pending.rows.length === 0) {
    console.log('[mail:send] 발송할 요약 메일이 없습니다.');
    return;
  }

  const fallbackHtml = renderReportHtml(await buildDailyReport());

  for (const row of pending.rows) {
    if (!row.recipients || row.recipients.length === 0) {
      await query(
        `UPDATE mail_jobs SET status='failed', error='no_recipients' WHERE id=$1`,
        [row.id],
      );
      await sendOpsAlert(
        `[TBELL Employ] 요약 메일 실패 — 수신자 없음`,
        `<p>mail_job <code>${row.id}</code> — recipients 비어 있음</p>`,
      );
      continue;
    }

    const html = row.body_html ?? fallbackHtml;

    try {
      await query(`UPDATE mail_jobs SET status='sending', attempt_count = attempt_count + 1 WHERE id=$1`, [
        row.id,
      ]);
      const result = await sendHtmlMail({
        to: row.recipients,
        subject: row.subject,
        html,
        allowDryRun: true,
      });

      if (result.dryRun) {
        await query(
          `UPDATE mail_jobs SET status='sent', sent_at=now(), error='dry_run_no_smtp' WHERE id=$1`,
          [row.id],
        );
        console.log(`[mail:send] dry-run 완료: ${row.id}`);
        continue;
      }

      await query(`UPDATE mail_jobs SET status='sent', sent_at=now(), error=NULL WHERE id=$1`, [row.id]);
      console.log(`[mail:send] 발송 완료: ${row.id} → ${row.recipients.join(', ')}`);
    } catch (err) {
      const message = (err as Error).message;
      const next = row.attempt_count + 1;
      const status = next >= MAX_ATTEMPTS ? 'failed' : 'retry';
      await query(
        `UPDATE mail_jobs SET status=$2, error=$3 WHERE id=$1`,
        [row.id, status, message],
      );
      console.error(`[mail:send] 실패(${status}): ${row.id}`, message);

      if (status === 'failed') {
        await sendOpsAlert(
          `[TBELL Employ] 요약 메일 발송 실패 (${MAX_ATTEMPTS}회)`,
          `<p>mail_job <code>${row.id}</code></p>
           <p>수신자: ${row.recipients.join(', ')}</p>
           <p>오류: ${message.replace(/</g, '&lt;')}</p>`,
        );
        process.exitCode = 1;
      }
    }
  }
}

main()
  .catch(async (err) => {
    console.error(err);
    await sendOpsAlert(
      `[TBELL Employ] mail:send 잡 오류`,
      `<p>${(err as Error).message.replace(/</g, '&lt;')}</p>`,
    ).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => closePool());
