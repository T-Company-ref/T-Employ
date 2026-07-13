import { env } from '../config/env.js';
import { sendHtmlMail } from '../mail/transport.js';

/** Gmail / Resend 메일 발송 테스트 */
async function main(): Promise<void> {
  const to = env.actionNotifyEmails();

  console.log('[dev:mail-test] 메일 설정:');
  if (env.gmailReady()) {
    const smtp = env.smtp();
    console.log('  provider=Gmail SMTP');
    console.log(`  GMAIL_USER=${smtp.user}`);
    console.log(`  from=${smtp.from}`);
  } else if (env.resend().apiKey) {
    console.log('  provider=Resend');
    console.log(`  RESEND_FROM=${env.resend().from}`);
  } else {
    console.log('  provider=(미설정)');
  }

  const result = await sendHtmlMail({
    to,
    subject: '[TBELL Employ] 메일 발송 테스트',
    html: `<p>T-Employ 메일 발송 테스트입니다.</p>
           <p>발신: ${env.mailFrom()}</p>
           <p>시각: ${new Date().toISOString()}</p>`,
    allowDryRun: false,
  });

  if (result.dryRun) {
    console.error(
      '[dev:mail-test] GMAIL_USER + GMAIL_APP_PASSWORD + MAIL_FROM (또는 RESEND_API_KEY) 를 설정하세요.',
    );
    process.exitCode = 1;
  } else {
    console.log(`[dev:mail-test] ✓ ${result.provider} 발송 성공 →`, to.join(', '));
  }
}

main().catch((err) => {
  console.error('[dev:mail-test] 실패:', err);
  process.exitCode = 1;
});
