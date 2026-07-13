import { env } from '../config/env.js';
import { sendHtmlMail } from './transport.js';

/** 운영자(yj.kim@tbell.co.kr 등)에게 경고/실패 알림 */
export async function sendOpsAlert(subject: string, html: string): Promise<void> {
  await sendHtmlMail({
    to: env.actionNotifyEmails(),
    subject,
    html,
    allowDryRun: true,
  });
}
