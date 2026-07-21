import { sendHtmlMail } from './transport.js';
import { resolveMailRecipients } from './recipients.js';

/** 운영자 경고/실패 알림 (인증 오류 등) */
export async function sendOpsAlert(subject: string, html: string): Promise<void> {
  await sendHtmlMail({
    to: await resolveMailRecipients('ops'),
    subject,
    html,
    allowDryRun: false,
  });
}
