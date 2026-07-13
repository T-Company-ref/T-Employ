import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import type { Platform } from '../db/types.js';
import { loadRouteMap } from './routeMap.js';
import { openSession } from './browser.js';
import { getConnector } from './connectors/index.js';
import type { CrawlContext } from './types.js';
import { createJob, finishJob, logJob, recordFailure } from '../db/repositories/crawlJobs.js';
import { recordHealth, type PlatformConfig } from '../db/repositories/platform.js';
import { upsertApplicants } from '../db/repositories/applicants.js';
import { upsertTalents } from '../db/repositories/talentPool.js';
import { upsertSessionMeta } from '../db/repositories/sessions.js';

export type RunKind = 'applicants' | 'talent_pool';

export interface RunResult {
  platform: Platform;
  skipped?: boolean;
  inserted?: number;
  updated?: number;
  error?: string;
  attempts?: number;
}

export interface RunOptions {
  clearSession?: boolean;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sessionFile(platform: Platform, alias = 'tbell-corp'): string {
  return resolve(process.cwd(), `.sessions/${platform}_${alias}.json`);
}

function clearSessionFile(platform: Platform): void {
  const path = sessionFile(platform);
  if (existsSync(path)) rmSync(path, { force: true });
}

/**
 * 단일 플랫폼 수집 실행. 사이트별로 격리되어 한 사이트 실패가 전체를 막지 않는다.
 */
export async function runPlatform(
  kind: RunKind,
  platform: Platform,
  triggerType: 'manual' | 'schedule' = 'manual',
  options: RunOptions = {},
): Promise<RunResult> {
  if (options.clearSession) clearSessionFile(platform);

  const job = await createJob({
    jobType: kind === 'applicants' ? 'applicants' : 'talent_pool',
    platform,
    triggerType,
    requestedBy: triggerType === 'schedule' ? 'scheduler' : 'cli',
  });

  if (!job) {
    return { platform, skipped: true, error: 'already_running' };
  }

  const routeMap = loadRouteMap(platform);
  const connector = getConnector(platform);
  const session = await openSession(platform);
  const timeoutMs = options.timeoutMs ?? 30_000;

  const ctx: CrawlContext = {
    page: session.page,
    routeMap,
    jobId: job.id,
    platform,
    log: (level, message, meta, step) => logJob(job.id, level, message, meta, step),
  };

  try {
    ctx.page.setDefaultTimeout(timeoutMs);

    const creds = env.platformCreds(platform);
    const loginResult = await connector.login(ctx, creds);
    if (!loginResult.ok) {
      await upsertSessionMeta({ platform, status: 'expired' });
      throw new Error(`login_failed: ${loginResult.reason ?? 'unknown'}`);
    }
    await session.saveSession();
    await upsertSessionMeta({ platform, status: 'valid' });

    let inserted = 0;
    let updated = 0;

    if (kind === 'applicants') {
      const records = await connector.crawlApplicants(ctx);
      const res = await upsertApplicants(records);
      inserted = res.inserted;
      updated = res.updated;
      if (res.resumesSaved) {
        await ctx.log('info', `이력서 PDF ${res.resumesSaved}건 저장`, undefined, 'resume');
      }
    } else {
      const records = await connector.crawlTalentPool(ctx);
      const res = await upsertTalents(records);
      inserted = res.inserted;
      updated = res.updated;
      if (res.resumesSaved) {
        await ctx.log('info', `이력서 PDF ${res.resumesSaved}건 저장`, undefined, 'resume');
      }
    }

    await finishJob(job.id, 'succeeded', {
      stats: { inserted, updated },
      result: { kind, inserted, updated },
    });
    await recordHealth(platform, true);
    return { platform, inserted, updated };
  } catch (err) {
    const message = (err as Error).message;
    const shot = await session.screenshot(`fail_${kind}`).catch(() => null);
    await recordFailure({
      jobId: job.id,
      platform,
      step: 'run',
      errorMessage: message,
      screenshotUrl: shot ?? undefined,
    });
    await finishJob(job.id, 'failed', { result: { error: message } });
    await recordHealth(platform, false, message);
    if (message.includes('session_expired') || message.includes('login_failed')) {
      await upsertSessionMeta({ platform, status: 'expired' });
    }
    return { platform, error: message };
  } finally {
    await session.close();
  }
}

/**
 * platform_configs.max_retries 기반 재시도.
 * 로그인/세션 만료 시 세션 파일 삭제 후 1회 재로그인 시도.
 */
export async function runPlatformWithRetry(
  kind: RunKind,
  platform: Platform,
  config: PlatformConfig,
  triggerType: 'manual' | 'schedule',
): Promise<RunResult> {
  const maxAttempts = Math.max(1, config.max_retries + 1);
  let last: RunResult = { platform, error: 'no_attempt' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const clearSession =
      attempt > 1 &&
      (last.error?.includes('login_failed') || last.error?.includes('session_expired'));
    if (attempt > 1) {
      await sleep(2000 * attempt);
      console.log(`[retry] ${platform} ${kind} attempt ${attempt}/${maxAttempts}`);
    }

    last = await runPlatform(kind, platform, triggerType, {
      clearSession,
      timeoutMs: config.timeout_ms,
    });
    last.attempts = attempt;

    if (last.skipped || !last.error) return last;
    if (last.error === 'already_running') return last;
  }

  return last;
}
