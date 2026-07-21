import { env } from '../config/env.js';

export interface SendMailParams {
  to: string[];
  subject: string;
  html: string;
  /** true 면 설정 누락 시 throw 대신 dry-run (로컬 디버그용) */
  allowDryRun?: boolean;
}

export interface SendMailResult {
  sent: boolean;
  dryRun: boolean;
  provider?: 'smtp';
}

function assertMailConfig(): { from: string } {
  const missing: string[] = [];
  const g = env.gmail();
  if (!g.user) missing.push('GMAIL_USER');
  if (!g.appPassword) missing.push('GMAIL_APP_PASSWORD');
  const from = env.mailFrom();
  if (!from) missing.push('MAIL_FROM');
  if (missing.length > 0) {
    throw new Error(
      `mail_not_configured: 필수 설정 누락 — ${missing.join(', ')}\n` +
        `  → .env / GitHub Secrets: GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM\n` +
        `  → 발신 예: MAIL_FROM=T-Employ <tbell.wr@gmail.com>`,
    );
  }
  return { from };
}

async function sendViaSmtp(params: SendMailParams): Promise<SendMailResult> {
  const { from } = assertMailConfig();
  const smtp = env.smtp();
  if (!smtp.host || !smtp.user || !smtp.password) {
    throw new Error('smtp_not_configured');
  }

  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    ...(smtp.isGmail ? { requireTLS: true } : {}),
  });

  try {
    await transport.sendMail({
      from,
      to: params.to.join(', '),
      subject: params.subject,
      html: params.html,
    });
  } catch (err) {
    const e = err as { code?: string; response?: string };
    if (
      e.code === 'EAUTH' &&
      (e.response?.includes('Application-specific password') ||
        e.response?.includes('534'))
    ) {
      throw new Error(
        'gmail_app_password_required: GMAIL_APP_PASSWORD 에 Google **앱 비밀번호**가 필요합니다.\n' +
          '  (일반 로그인 비밀번호는 사용 불가)\n' +
          '  → https://myaccount.google.com/apppasswords 에서 16자리 앱 비밀번호 발급',
      );
    }
    throw err;
  }

  console.log(`[mail/smtp] 발송 완료 → ${params.to.join(', ')}`);
  return { sent: true, dryRun: false, provider: 'smtp' };
}

function dryRun(from: string, params: SendMailParams): SendMailResult {
  console.log('[mail] dry-run 발신:', from || '(미설정)');
  console.log('[mail] dry-run 수신:', params.to.join(', '));
  console.log('[mail] dry-run 제목:', params.subject);
  console.log('[mail] dry-run 본문 미리보기:', params.html.slice(0, 300), '...');
  return { sent: false, dryRun: true };
}

/**
 * HTML 메일 발송 (Gmail SMTP).
 * GMAIL_USER · GMAIL_APP_PASSWORD · MAIL_FROM 필수. 비밀번호는 로그에 출력하지 않음.
 */
export async function sendHtmlMail(params: SendMailParams): Promise<SendMailResult> {
  const recipients = params.to.filter(Boolean);
  if (recipients.length === 0) {
    throw new Error('no_recipients');
  }

  const payload = { ...params, to: recipients };

  try {
    return await sendViaSmtp(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (params.allowDryRun && message.startsWith('mail_not_configured:')) {
      console.warn(`[mail] ${message.split('\n')[0]} — dry-run`);
      return dryRun(env.mailFrom(), payload);
    }
    throw err;
  }
}
