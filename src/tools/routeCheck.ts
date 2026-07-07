import { loadRouteMap, findUnsetSelectors } from '../crawler/routeMap.js';
import { registeredPlatforms } from '../crawler/connectors/index.js';

/**
 * Route Map dry-run 검증 도구.
 * 각 플랫폼 YAML 을 로드하고 아직 채워지지 않은(TODO) 셀렉터를 리포트한다.
 * Phase 0 완료 판정: 미설정 셀렉터 0개.
 */
function main(): void {
  let hasUnset = false;
  for (const platform of registeredPlatforms()) {
    try {
      const map = loadRouteMap(platform);
      const unset = findUnsetSelectors(map);
      console.log(`\n[${platform}] version=${map.version}`);
      console.log(`  routes: ${Object.keys(map.routes).join(', ')}`);
      if (unset.length > 0) {
        hasUnset = true;
        console.log(`  미설정 셀렉터(${unset.length}): ${unset.join(', ')}`);
      } else {
        console.log('  셀렉터 설정 완료');
      }
    } catch (err) {
      hasUnset = true;
      console.error(`  로드 실패: ${(err as Error).message}`);
    }
  }

  console.log(
    hasUnset
      ? '\n결과: 아직 채워야 할 셀렉터가 있습니다 (Phase 0 진행 중).'
      : '\n결과: 모든 Route Map 셀렉터 설정 완료.',
  );
}

main();
