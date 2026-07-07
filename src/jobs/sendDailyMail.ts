import { query, closePool } from '../db/client.js';
import { buildDailyReport } from '../db/repositories/reporting.js';
import { renderReportHtml } from './composeDailyReport.js';
import { env } from '../config/env.js';

interface MailJobRow {
  id: string;
  recipients: string[];
  subject: string;
  attempt_count: number;
}

/**
 * 매일 08:00 KST: queued/retry 상태의 daily_report 메일을 발송한다.
 * 실패 시 attempt_count 증가 및 retry 표시(최대 3회), 이후 failed.
 */
async function sendMail(row: MailJobRow, html: string): Promise<void> {
  const smtp = env.smtp();
  if (!smtp.host) {
    // SMTP 미설정 시(로컬/CI dry-run) 실제 발송 생략
    console.warn('[mail:send] SMTP 미설정 - 발송 생략(dry-run)');
    console.log('수신자:', row.recipients.join(', '));
    return;
  }

  // nodemailer 는 SMTP 설정이 있을 때만 동적 로드
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });

  await transport.sendMail({
    from: smtp.from,
    to: row.recipients.join(', '),
    subject: row.subject,
    html,
  });
}

async function main(): Promise<void> {
  const pending = await query<MailJobRow>(
    `SELECT id, recipients, subject, attempt_count
     FROM mail_jobs
     WHERE mail_type = 'daily_report' AND status IN ('queued', 'retry')
     ORDER BY created_at ASC`,
  );

  if (pending.rows.length === 0) {
    console.log('[mail:send] 발송할 요약 메일이 없습니다.');
    return;
  }

  const report = await buildDailyReport();
  const html = renderReportHtml(report);

  for (const row of pending.rows) {
    if (!row.recipients || row.recipients.length === 0) {
      await query(
        `UPDATE mail_jobs SET status='failed', error='no_recipients' WHERE id=$1`,
        [row.id],
      );
      continue;
    }
    try {
      await query(`UPDATE mail_jobs SET status='sending' WHERE id=$1`, [row.id]);
      await sendMail(row, html);
      await query(`UPDATE mail_jobs SET status='sent', sent_at=now() WHERE id=$1`, [row.id]);
      console.log(`[mail:send] 발송 완료: ${row.id}`);
    } catch (err) {
      const next = row.attempt_count + 1;
      const status = next >= 3 ? 'failed' : 'retry';
      await query(
        `UPDATE mail_jobs SET status=$2, attempt_count=$3, error=$4 WHERE id=$1`,
        [row.id, status, next, (err as Error).message],
      );
      console.error(`[mail:send] 실패(${status}): ${row.id}`, (err as Error).message);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
