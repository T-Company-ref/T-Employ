import { sendHtmlMail } from '../mail/transport.js';
import { resolveMailRecipients } from '../mail/recipients.js';

function runUrl(): string {
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const runId = process.env.GITHUB_RUN_ID ?? '';
  if (!repo || !runId) return '(로컬 실행)';
  return `${server}/${repo}/actions/runs/${runId}`;
}

function statusColor(conclusion: string): string {
  if (conclusion === 'success') return '#16a34a';
  if (conclusion === 'failure') return '#dc2626';
  if (conclusion === 'cancelled') return '#6b7280';
  return '#d97706';
}

/**
 * GitHub Actions 워크플로 실행 결과를 운영자에게 메일로 통지한다.
 * usage: notifyActionResult.ts <workflow_name> <conclusion> [extra_message]
 */
async function main(): Promise<void> {
  const workflow = process.argv[2] ?? process.env.GITHUB_WORKFLOW ?? 'unknown';
  const conclusion = process.argv[3] ?? 'unknown';
  const extra = process.argv.slice(4).join(' ').trim();
  const event = process.env.GITHUB_EVENT_NAME ?? 'local';
  const branch = process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? '';
  const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  const actor = process.env.GITHUB_ACTOR ?? 'local';
  const to = await resolveMailRecipients('ops');

  const subject = `[TBELL Employ Actions] ${workflow} — ${conclusion}`;
  const html = `<!DOCTYPE html><html lang="ko"><body style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
  <h2 style="color:${statusColor(conclusion)}">워크플로 ${conclusion}</h2>
  <table cellpadding="6" style="border-collapse:collapse">
    <tr><td><b>워크플로</b></td><td>${workflow}</td></tr>
    <tr><td><b>결과</b></td><td>${conclusion}</td></tr>
    <tr><td><b>트리거</b></td><td>${event}</td></tr>
    <tr><td><b>브랜치</b></td><td>${branch}</td></tr>
    <tr><td><b>커밋</b></td><td>${sha || '-'}</td></tr>
    <tr><td><b>실행자</b></td><td>${actor}</td></tr>
    <tr><td><b>Run</b></td><td><a href="${runUrl()}">${runUrl()}</a></td></tr>
  </table>
  ${extra ? `<p><b>메모:</b> ${extra.replace(/</g, '&lt;')}</p>` : ''}
  </body></html>`;

  await sendHtmlMail({ to, subject, html, allowDryRun: true });
  console.log(`[notify:action] ${workflow} (${conclusion}) → ${to.join(', ')}`);
}

main().catch((err) => {
  console.error('[notify:action] 실패:', err);
  process.exitCode = 1;
});
