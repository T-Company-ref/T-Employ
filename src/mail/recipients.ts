/**
 * 메일 수신자 해석.
 * - ops/인증: ACTION_NOTIFY_EMAIL (항상)
 * - 지원·다이제스트: staff_profiles.notify_pref + ops
 */
import { query } from '../db/client.js';
import { env } from '../config/env.js';

export type NotifyChannel = 'realtime' | 'digest' | 'ops';

function normalizeEmails(list: string[]): string[] {
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** staff.notify_pref 기준 수신자. DB 실패 시 빈 배열. */
async function staffEmailsFor(channel: 'realtime' | 'digest'): Promise<string[]> {
  try {
    const prefs =
      channel === 'realtime'
        ? ['realtime']
        : ['digest', 'realtime']; // digest 메일에는 실시간 구독자도 포함
    const res = await query<{ email: string }>(
      `SELECT email FROM staff_profiles
       WHERE is_active = true
         AND email IS NOT NULL
         AND notify_pref = ANY($1::text[])`,
      [prefs],
    );
    return res.rows.map((r) => r.email).filter(Boolean);
  } catch (err) {
    console.warn(
      '[mail/recipients] staff notify_pref 조회 실패 — ops 수신자만 사용:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * channel:
 * - ops: 인증/장애 (ACTION_NOTIFY_EMAIL만)
 * - realtime: 즉시 지원 알림
 * - digest: 아침 다이제스트
 */
export async function resolveMailRecipients(channel: NotifyChannel): Promise<string[]> {
  const forceTo = (process.env.DIGEST_FORCE_TO || '').trim();
  if (forceTo && channel === 'digest') {
    return normalizeEmails(forceTo.split(/[,;\s]+/));
  }
  const ops = env.actionNotifyEmails();
  if (channel === 'ops') return normalizeEmails(ops);

  const fromStaff = await staffEmailsFor(channel);
  return normalizeEmails([...ops, ...fromStaff]);
}
