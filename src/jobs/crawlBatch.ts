import {
  getEnabledPlatforms,
  type PlatformConfig,
} from '../db/repositories/platform.js';
import {
  runPlatformWithRetry,
  type RunKind,
  type RunResult,
} from '../crawler/runner.js';
import { assertScheduledAutomationAllowed } from '../crawler/crawlPolicy.js';
import { crawlTriggerType } from '../crawler/trigger.js';
import { isWithinCrawlWindow } from '../crawler/crawlWindow.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function platformDelayMs(cfg: PlatformConfig): number {
  return Math.max(1000, Math.ceil(60_000 / Math.max(1, cfg.rate_limit)));
}

/** 공통 크롤 배치 — crawl_window·재시도·rate_limit 적용 */
export async function runCrawlBatch(
  taskName: string,
  kind: RunKind,
  only?: string,
): Promise<RunResult[]> {
  assertScheduledAutomationAllowed(taskName);
  const triggerType = crawlTriggerType();

  const configs = await getEnabledPlatforms();
  const targets = only ? configs.filter((c) => c.platform === only) : configs;

  if (targets.length === 0) {
    console.warn(`[${taskName}] 대상 플랫폼이 없습니다.`);
    return [];
  }

  const results: RunResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const cfg = targets[i];

    if (triggerType === 'schedule' && !isWithinCrawlWindow(cfg.crawl_window)) {
      console.warn(
        `[${taskName}] ${cfg.platform} crawl_window 밖 — 스킵 (${cfg.crawl_window})`,
      );
      results.push({
        platform: cfg.platform,
        skipped: true,
        error: 'outside_crawl_window',
      });
      continue;
    }

    console.log(`[${taskName}] ${cfg.platform} 시작 (trigger=${triggerType})`);
    const res = await runPlatformWithRetry(kind, cfg.platform, cfg, triggerType);
    results.push(res);
    console.log(`[${taskName}] ${cfg.platform} 결과:`, res);

    if (i < targets.length - 1) {
      const delay = platformDelayMs(cfg);
      console.log(`[${taskName}] rate_limit 대기 ${delay}ms`);
      await sleep(delay);
    }
  }

  const failed = results.filter((r) => r.error && !r.skipped);
  if (failed.length > 0) process.exitCode = 1;

  return results;
}
