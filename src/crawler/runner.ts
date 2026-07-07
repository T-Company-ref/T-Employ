import { env } from '../config/env.js';
import type { Platform } from '../db/types.js';
import { loadRouteMap } from './routeMap.js';
import { openSession } from './browser.js';
import { getConnector } from './connectors/index.js';
import type { CrawlContext } from './types.js';
import { createJob, finishJob, logJob, recordFailure } from '../db/repositories/crawlJobs.js';
import { recordHealth } from '../db/repositories/platform.js';
import { upsertApplicants } from '../db/repositories/applicants.js';
import { upsertTalents } from '../db/repositories/talentPool.js';

export type RunKind = 'applicants' | 'talent_pool';

export interface RunResult {
  platform: Platform;
  skipped?: boolean;
  inserted?: number;
  updated?: number;
  error?: string;
}

/**
 * 단일 플랫폼 수집 실행. 사이트별로 격리되어 한 사이트 실패가 전체를 막지 않는다.
 */
export async function runPlatform(kind: RunKind, platform: Platform): Promise<RunResult> {
  const job = await createJob({
    jobType: kind === 'applicants' ? 'applicants' : 'talent_pool',
    platform,
    triggerType: 'schedule',
  });

  // 동시 실행 제약으로 이미 활성 작업이 있으면 스킵
  if (!job) {
    return { platform, skipped: true, error: 'already_running' };
  }

  const routeMap = loadRouteMap(platform);
  const connector = getConnector(platform);
  const session = await openSession(platform);

  const ctx: CrawlContext = {
    page: session.page,
    routeMap,
    jobId: job.id,
    platform,
    log: (level, message, meta, step) => logJob(job.id, level, message, meta, step),
  };

  try {
    const creds = env.platformCreds(platform);
    const loginResult = await connector.login(ctx, creds);
    if (!loginResult.ok) {
      throw new Error(`login_failed: ${loginResult.reason ?? 'unknown'}`);
    }
    await session.saveSession();

    let inserted = 0;
    let updated = 0;

    if (kind === 'applicants') {
      const records = await connector.crawlApplicants(ctx);
      const res = await upsertApplicants(records);
      inserted = res.inserted;
      updated = res.updated;
    } else {
      const records = await connector.crawlTalentPool(ctx);
      const res = await upsertTalents(records);
      inserted = res.inserted;
      updated = res.updated;
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
    return { platform, error: message };
  } finally {
    await session.close();
  }
}
