import { getScheduledSuccessRate } from '../db/repositories/crawlStats.js';
import { closePool } from '../db/client.js';

/** 최근 N일 스케줄 크롤 성공률 (Phase 2 모니터링, 목표 90%+) */
async function main(): Promise<void> {
  const days = Number(process.argv[2] ?? 7);
  const stats = await getScheduledSuccessRate(days);

  console.log(`\n[dev:crawl-stats] 최근 ${stats.days}일 스케줄 크롤 성공률`);
  console.log(`  전체: ${stats.succeeded}/${stats.total} (${stats.ratePercent}%)`);
  for (const row of stats.byPlatform) {
    console.log(
      `  ${row.platform}: ${row.succeeded}/${row.total} (${row.ratePercent}%)`,
    );
  }

  const target = 90;
  if (stats.total > 0 && stats.ratePercent < target) {
    console.warn(`\n  ⚠ 목표 ${target}% 미달`);
    process.exitCode = 1;
  } else if (stats.total === 0) {
    console.log('\n  (스케줄 실행 이력 없음 — cron 가동 후 재확인)');
  } else {
    console.log(`\n  ✓ 목표 ${target}% 이상`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
