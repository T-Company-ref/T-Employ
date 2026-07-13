import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import type { Platform } from '../db/types.js';
import { loadRouteMap } from '../crawler/routeMap.js';
import { openSession } from '../crawler/browser.js';
import { getConnector } from '../crawler/connectors/index.js';
import type { CrawlContext } from '../crawler/types.js';
import { upsertSessionMeta } from '../db/repositories/sessions.js';
import { closePool } from '../db/client.js';

const ALIAS = 'tbell-corp';

function sessionPath(platform: Platform): string {
  return resolve(process.cwd(), `.sessions/${platform}_${ALIAS}.json`);
}

/**
 * 저장된 storageState 를 삭제하고 재로그인해 세션을 갱신한다.
 * CI(db-snapshot) 에는 db:dump 시 sessions-bundle.json 으로 함께 지속된다.
 */
async function main(): Promise<void> {
  const platform = (process.argv[2] ?? 'jobkorea') as Platform;
  const path = sessionPath(platform);
  if (existsSync(path)) {
    rmSync(path, { force: true });
    console.log(`[refresh-session] 기존 세션 삭제: ${path}`);
  }

  const session = await openSession(platform, ALIAS);
  const routeMap = loadRouteMap(platform);
  const connector = getConnector(platform);

  const ctx: CrawlContext = {
    page: session.page,
    routeMap,
    jobId: 'refresh-session',
    platform,
    log: async () => {},
  };

  try {
    const creds = env.platformCreds(platform);
    const loginResult = await connector.login(ctx, creds);
    if (!loginResult.ok) {
      await upsertSessionMeta({ platform, accountAlias: ALIAS, status: 'expired' });
      throw new Error(`login_failed: ${loginResult.reason ?? 'unknown'}`);
    }

    await session.saveSession();
    await upsertSessionMeta({
      platform,
      accountAlias: ALIAS,
      status: 'valid',
      storageRef: `.sessions/${platform}_${ALIAS}.json`,
    });
    console.log(`[refresh-session] ${platform} 세션 갱신 완료`);
  } finally {
    await session.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
