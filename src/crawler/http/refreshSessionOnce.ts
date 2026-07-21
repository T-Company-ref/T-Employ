import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../../config/env.js';
import type { Platform } from '../../db/types.js';
import { loadRouteMap } from '../routeMap.js';
import { openSession } from '../browser.js';
import { getConnector } from '../connectors/index.js';
import type { CrawlContext } from '../types.js';
import { upsertSessionMeta } from '../../db/repositories/sessions.js';
import { sessionStatePath } from './sessionCookies.js';

const ALIAS = 'tbell-corp';

/**
 * Playwright로 재로그인 후 storageState 저장 (1회).
 * poll / session:refresh 공용.
 */
export async function refreshPlatformSession(
  platform: Platform = 'jobkorea',
  options: { clearExisting?: boolean } = {},
): Promise<{ path: string }> {
  process.env.HEADLESS = process.env.HEADLESS || 'true';
  const path = sessionStatePath(platform, ALIAS);

  if (options.clearExisting !== false && existsSync(path)) {
    rmSync(path, { force: true });
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
    return { path: resolve(path) };
  } finally {
    await session.close().catch(() => undefined);
  }
}
