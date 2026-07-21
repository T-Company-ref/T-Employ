import { env } from '../config/env.js';
import { sendHtmlMail } from '../mail/transport.js';

/** Gmail SMTP 메일 발송 테스트 */
async function main(): Promise<void> {
  const to = env.actionNotifyEmails();

  console.log('[dev:mail-test] 메일 설정:');
  console.log('  provider=Gmail SMTP');
  console.log(`  ready=${env.mailReady()}`);
  console.log(`  user=${env.gmail().user || '(미설정)'}`);
  console.log(`  from=${env.mailFrom() || '(미설정)'}`);
  console.log(`  to=${to.join(', ')}`);
  // GMAIL_APP_PASSWORD 값은 출력하지 않음

  const result = await sendHtmlMail({
    to,
    subject: '[TBELL Employ] 메일 발송 테스트',
    html: `<p>T-Employ 메일 발송 테스트입니다.</p>
           <p>발신: ${env.mailFrom()}</p>
           <p>시각: ${new Date().toISOString()}</p>`,
    allowDryRun: false,
  });

  console.log(`[dev:mail-test] ✓ ${result.provider} 발송 성공 →`, to.join(', '));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[dev:mail-test] 실패:', message);
  process.exitCode = 1;
});
