import { env } from '../config/env.js';

export interface SendMailParams {
  to: string[];
  subject: string;
  html: string;
  /** dry-run 시에도 true면 콘솔만 출력하고 성공 처리 */
  allowDryRun?: boolean;
}

export interface SendMailResult {
  sent: boolean;
  dryRun: boolean;
  provider?: 'resend' | 'smtp';
}

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m?.[1] ?? from).trim().toLowerCase();
}

function assertResendFromAllowed(from: string): void {
  const email = extractEmail(from);
  const domain = email.split('@')[1] ?? '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    throw new Error(
      `resend_from_gmail_blocked: Resend는 @gmail.com 발신을 허용하지 않습니다.\n` +
        `  → RESEND_FROM 을 인증된 도메인으로 변경 (예: T-Employ <noreply@tbell.co.kr>)\n` +
        `  → Resend 대시보드: https://resend.com/domains 에서 tbell.co.kr DNS 인증\n` +
        `  → 또는 Gmail 직접 발송: RESEND_API_KEY 비우고 SMTP_USER=tbell.wr@gmail.com + 앱 비밀번호`,
    );
  }
}

function formatResendError(status: number, body: string): string {
  if (status === 403 && body.includes('not verified')) {
    return (
      `resend_http_${status}: 발신 도메인이 Resend에 인증되지 않았습니다.\n` +
      `  API 응답: ${body}\n` +
      `  → https://resend.com/domains 에서 도메인 DNS 레코드 추가 후 RESEND_FROM 갱신`
    );
  }
  return `resend_http_${status}: ${body}`;
}

async function sendViaResend(
  from: string,
  apiKey: string,
  replyTo: string | undefined,
  params: SendMailParams,
): Promise<SendMailResult> {
  assertResendFromAllowed(from);

  const payload: Record<string, unknown> = {
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  };
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(formatResendError(res.status, body));
  }

  console.log(`[mail/resend] 발송 완료: ${from} → ${params.to.join(', ')}`);
  return { sent: true, dryRun: false, provider: 'resend' };
}

async function sendViaSmtp(params: SendMailParams): Promise<SendMailResult> {
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
      from: smtp.from,
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
          '  → https://myaccount.google.com/apppasswords 에서 16자리 앱 비밀번호 발급\n' +
          '  → .env: GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx (공백 있어도 자동 제거)\n' +
          '  → GitHub Secrets GMAIL_APP_PASSWORD 도 함께 갱신',
      );
    }
    throw err;
  }

  console.log(`[mail/smtp] 발송 완료: ${smtp.from} → ${params.to.join(', ')}`);
  return { sent: true, dryRun: false, provider: 'smtp' };
}

function dryRun(from: string, params: SendMailParams): SendMailResult {
  console.log('[mail] dry-run 발신:', from);
  console.log('[mail] dry-run 수신:', params.to.join(', '));
  console.log('[mail] dry-run 제목:', params.subject);
  console.log('[mail] dry-run 본문 미리보기:', params.html.slice(0, 300), '...');
  return { sent: false, dryRun: true };
}

/**
 * HTML 메일 발송.
 * 1순위: Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD + MAIL_FROM)
 * 2순위: Resend API (인증 도메인만 — @gmail.com 불가)
 */
export async function sendHtmlMail(params: SendMailParams): Promise<SendMailResult> {
  const recipients = params.to.filter(Boolean);
  if (recipients.length === 0) {
    throw new Error('no_recipients');
  }

  const payload = { ...params, to: recipients };

  if (env.gmailReady()) {
    return sendViaSmtp(payload);
  }

  const resend = env.resend();

  if (resend.apiKey) {
    return sendViaResend(resend.from, resend.apiKey, resend.replyTo || undefined, payload);
  }

  const smtp = env.smtp();
  if (smtp.host && smtp.user && smtp.password) {
    return sendViaSmtp(payload);
  }

  if (!params.allowDryRun) {
    console.warn('[mail] RESEND_API_KEY / SMTP 미설정 — 발송 생략(dry-run)');
  }
  return dryRun(env.mailFrom(), payload);
}
