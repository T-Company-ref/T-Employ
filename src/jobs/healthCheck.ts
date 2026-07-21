/**
 * 운영 헬스체크 — 24시간 이상 지원자 폴링 성공이 없으면 알림.
 *
 * usage:
 *   npm run ops:health
 *   npm run ops:health -- --hours 24
 *   npm run ops:health -- --force   # 쿨다운 무시하고 알림
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closePool } from '../db/client.js';
import {
  getLastApplicantsSuccessAt,
  getPlatformHealth,
} from '../db/repositories/platform.js';
import { sendOpsAlert } from '../mail/alerts.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';
import { sessionStatePath } from '../crawler/http/sessionCookies.js';

const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

function parseHours(): number {
  const idx = process.argv.indexOf('--hours');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return Number(process.env.HEALTH_STALE_HOURS || '24') || 24;
}

function alertStatePath(): string {
  const dir = resolve(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return resolve(dir, 'health-alert-state.json');
}

function lastAlertAt(): number {
  try {
    const raw = JSON.parse(readFileSync(alertStatePath(), 'utf8')) as { at?: string };
    return raw.at ? new Date(raw.at).getTime() : 0;
  } catch {
    return 0;
  }
}

function markAlerted(): void {
  writeFileSync(alertStatePath(), JSON.stringify({ at: new Date().toISOString() }, null, 2));
}

function readHeartbeat(): { at?: string } | null {
  try {
    return JSON.parse(
      readFileSync(resolve(process.cwd(), 'data/poll-heartbeat.json'), 'utf8'),
    ) as { at?: string };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  assertScheduledAutomationAllowed('ops:health');
  const hours = parseHours();
  const force = process.argv.includes('--force');
  const staleMs = hours * 60 * 60 * 1000;
  const now = Date.now();

  const health = await getPlatformHealth('jobkorea');
  const lastJobOk = await getLastApplicantsSuccessAt();
  const heartbeat = readHeartbeat();
  const sessionPath = sessionStatePath('jobkorea');
  const sessionExists = existsSync(sessionPath);

  const candidates: number[] = [];
  if (health?.last_ok_at) {
    candidates.push(new Date(health.last_ok_at).getTime());
  }
  if (lastJobOk) candidates.push(lastJobOk.getTime());
  if (heartbeat?.at) candidates.push(new Date(heartbeat.at).getTime());

  const latestOk = candidates.length ? Math.max(...candidates) : null;
  const ageMs = latestOk == null ? Number.POSITIVE_INFINITY : now - latestOk;
  const stale = ageMs > staleMs;

  const summary = {
    hours,
    stale,
    latestOk: latestOk ? new Date(latestOk).toISOString() : null,
    ageHours: latestOk ? +(ageMs / 3_600_000).toFixed(2) : null,
    platformStatus: health?.status ?? null,
    failCount24h: health?.fail_count_24h ?? null,
    lastError: health?.last_error ?? null,
    sessionExists,
    heartbeatAt: heartbeat?.at ?? null,
  };
  console.log('[ops:health]', JSON.stringify(summary));

  if (!stale) {
    console.log('[ops:health] ok');
    return;
  }

  const sinceAlert = now - lastAlertAt();
  if (!force && sinceAlert < ALERT_COOLDOWN_MS) {
    console.log(
      `[ops:health] stale but alert cooldown (${Math.round(sinceAlert / 3_600_000)}h ago) — skip mail`,
    );
    process.exitCode = 1;
    return;
  }

  const ageLabel =
    latestOk == null ? '기록 없음' : `${(ageMs / 3_600_000).toFixed(1)}시간 전`;

  await sendOpsAlert(
    `[TBELL] 헬스체크 경고 · ${hours}h 무소식`,
    `<p>지원자 폴링/크롤 성공이 <b>${hours}시간</b> 이상 없습니다.</p>
     <ul>
       <li>마지막 성공: <b>${ageLabel}</b> ${summary.latestOk ? `(${summary.latestOk})` : ''}</li>
       <li>platform_health: ${summary.platformStatus ?? '-'} / fail24h=${summary.failCount24h ?? 0}</li>
       <li>세션 파일: ${sessionExists ? '있음' : '<b>없음</b>'}</li>
       <li>last_error: ${(summary.lastError || '-').replace(/</g, '&lt;')}</li>
     </ul>
     <p>Oracle: <code>systemctl list-timers 't-employ-*'</code> · <code>npm run session:refresh</code> · <code>npm run poll:applicants</code></p>`,
  );
  markAlerted();
  console.log('[ops:health] alert mailed');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
