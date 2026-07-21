import { sendOpsAlert } from '../mail/alerts.js';
import {
  classifyAuthError,
  markSessionExpired,
  type PlatformAuthState,
} from '../crawler/session/authState.js';
import type { Platform } from '../db/types.js';
import { upsertSessionMeta } from '../db/repositories/sessions.js';

function runUrl(): string {
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const runId = process.env.GITHUB_RUN_ID ?? '';
  if (!repo || !runId) return '(로컬 실행 — Actions URL 없음)';
  return `${server}/${repo}/actions/runs/${runId}`;
}

function workflowName(): string {
  return process.env.GITHUB_WORKFLOW ?? process.env.T_EMPLOY_WORKFLOW ?? 'local';
}

/**
 * 인증/세션 오류 처리: 상태 저장 + (최초 1회만) 관리자 메일.
 * 자동 session:refresh 는 하지 않는다 — 사용자가 Actions에서 수동 실행.
 */
export async function handleAuthFailure(params: {
  err: unknown;
  platform?: Platform;
  workflow?: string;
}): Promise<{ handledAsAuth: boolean; notified: boolean; state?: PlatformAuthState }> {
  const platform = params.platform ?? 'jobkorea';
  const workflow = params.workflow ?? workflowName();
  const classified = classifyAuthError(params.err);

  if (!classified.isAuth) {
    return { handledAsAuth: false, notified: false };
  }

  await upsertSessionMeta({ platform, status: 'expired' }).catch(() => undefined);
  const { shouldNotify, state } = markSessionExpired(platform, classified.reason, workflow);

  if (!shouldNotify) {
    console.warn(`[auth] session expired (already notified) — ${classified.reason.slice(0, 120)}`);
    return { handledAsAuth: true, notified: false, state };
  }

  const when = state.errorAt ?? new Date().toISOString();
  await sendOpsAlert(
    `[TBELL] 세션 만료 · ${workflow}`,
    `<p>잡코리아(기업) 세션이 만료되어 작업이 중단되었습니다.</p>
     <table cellpadding="6" style="border-collapse:collapse">
       <tr><td><b>workflow</b></td><td>${workflow}</td></tr>
       <tr><td><b>시각</b></td><td>${when}</td></tr>
       <tr><td><b>유형</b></td><td>session_expired / auth</td></tr>
       <tr><td><b>근거</b></td><td>${classified.reason.replace(/</g, '&lt;').slice(0, 400)}</td></tr>
       <tr><td><b>Run</b></td><td><a href="${runUrl()}">${runUrl()}</a></td></tr>
     </table>
     <p><b>조치:</b> GitHub Actions → <code>session-refresh</code> workflow를
     <b>Run workflow</b>로 수동 실행한 뒤, 실패한 작업을 다시 돌려 주세요.</p>
     <p>동일 세션 오류가 반복되어도 복구 전까지 이 메일은 다시 보내지 않습니다.</p>`,
  );
  console.warn(`[auth] session expired — notified admin (${classified.reason.slice(0, 120)})`);
  return { handledAsAuth: true, notified: true, state };
}
