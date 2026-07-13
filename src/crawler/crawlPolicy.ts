import { env } from '../config/env.js';

/**
 * 스케줄(cron) 기반 자동 크롤 실행 제어.
 * 로컬 기본값 false — GitHub Actions 크롤 워크플로는 Phase 2부터 true.
 * 로컬 CLI·workflow_dispatch 수동 실행은 허용한다.
 */
export function assertScheduledAutomationAllowed(task: string): void {
  if (env.autoCrawlEnabled()) return;

  const event = process.env.GITHUB_EVENT_NAME;
  if (event === 'schedule') {
    throw new Error(
      `[${task}] 자동 실행이 비활성화되어 있습니다 (AUTO_CRAWL_ENABLED=false). Phase 2에서 활성화하세요.`,
    );
  }
}
