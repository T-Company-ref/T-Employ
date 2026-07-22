/**
 * 지원자 폴링.
 * - 로컬: HTTP(fetch) 기본
 * - Actions: Chromium (지원자 목록이 request HTML에 비는 문제 회피)
 *
 * usage:
 *   npm run poll:applicants
 *   npm run poll:applicants -- --limit 50
 *   npm run poll:applicants -- --dry-run
 */
import { closePool } from '../db/client.js';
import { createJob, finishJob, logJob } from '../db/repositories/crawlJobs.js';
import { upsertApplicants } from '../db/repositories/applicants.js';
import { recordHealth } from '../db/repositories/platform.js';
import { pollJobkoreaApplicants } from '../crawler/http/jobkoreaPollApplicants.js';
import { sendApplicantCrawlResultMail } from '../mail/crawlResult.js';
import { handleAuthFailure } from '../mail/sessionAuthAlert.js';
import { markSessionOk, classifyAuthError } from '../crawler/session/authState.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';
import { crawlTriggerType } from '../crawler/trigger.js';
import type { RunResult } from '../crawler/runner.js';
import { env } from '../config/env.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function parseLimit(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return env.crawlMaxItems();
}

function touchHeartbeat(meta: Record<string, unknown>): void {
  const dir = resolve(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'poll-heartbeat.json'),
    JSON.stringify({ at: new Date().toISOString(), ...meta }, null, 2),
    'utf8',
  );
}

async function main(): Promise<void> {
  assertScheduledAutomationAllowed('poll:applicants');
  const triggerType = crawlTriggerType();
  const limit = parseLimit();
  const dryRun = process.argv.includes('--dry-run');
  const sendMail = !process.argv.includes('--no-mail');

  const job = await createJob({
    jobType: 'applicants',
    platform: 'jobkorea',
    triggerType,
    requestedBy: triggerType === 'schedule' ? 'poller' : 'cli',
  });

  if (!job) {
    console.warn('[poll:applicants] already_running — 스킵');
    return;
  }

  let result: RunResult = { platform: 'jobkorea' };

  try {
    await logJob(job.id, 'info', `경량 폴링 시작 limit=${limit}`, { limit, dryRun }, 'poll_start');
    const polled = await pollJobkoreaApplicants({ limit });
    await logJob(
      job.id,
      'info',
      `수집 postings=${polled.postings} applicants=${polled.applicants.length}`,
      { postings: polled.postings, count: polled.applicants.length },
      'poll_collect',
    );

    if (dryRun) {
      result = { platform: 'jobkorea', inserted: 0, updated: 0, newItems: [] };
      await finishJob(job.id, 'succeeded', {
        result: { mode: 'http_html', dryRun: true, fetched: polled.applicants.length },
      });
      console.log(`[poll:applicants] dry-run fetched=${polled.applicants.length}`);
      return;
    }

    const upserted = await upsertApplicants(polled.applicants);
    result = {
      platform: 'jobkorea',
      inserted: upserted.inserted,
      updated: upserted.updated,
      resumesSaved: 0,
      newItems: upserted.newItems,
    };

    await finishJob(job.id, 'succeeded', {
      result: {
        mode: 'http_html',
        postings: polled.postings,
        fetched: polled.applicants.length,
        inserted: upserted.inserted,
        updated: upserted.updated,
        newItems: upserted.newItems?.length ?? 0,
      },
    });
    await recordHealth('jobkorea', true);
    markSessionOk('jobkorea');
    touchHeartbeat({
      fetched: polled.applicants.length,
      inserted: upserted.inserted,
      newItems: upserted.newItems?.length ?? 0,
    });

    console.log(
      `[poll:applicants] ok fetched=${polled.applicants.length} inserted=${upserted.inserted} updated=${upserted.updated} new=${upserted.newItems?.length ?? 0}`,
    );

    if ((upserted.newItems?.length ?? 0) === 0) {
      console.log('[poll:applicants] 신규 없음 — 메일 생략');
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { platform: 'jobkorea', error: message };
    await finishJob(job.id, 'failed', { result: { error: message } });
    await recordHealth('jobkorea', false, message);

    const auth = await handleAuthFailure({ err, platform: 'jobkorea' });
    if (!auth.handledAsAuth) {
      const c = classifyAuthError(err);
      console.error(`[poll:applicants] failed (${c.isTransient ? 'transient' : 'other'}): ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (sendMail) {
    try {
      await sendApplicantCrawlResultMail([result]);
    } catch (mailErr) {
      console.error('[poll:applicants] 결과 메일 실패:', mailErr);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
