import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Platform } from '../../db/types.js';

const ALIAS = 'tbell-corp';

export type StorageCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export type StorageState = {
  cookies: StorageCookie[];
  origins?: unknown[];
};

export function sessionStatePath(platform: Platform = 'jobkorea', alias = ALIAS): string {
  return resolve(process.cwd(), `.sessions/${platform}_${alias}.json`);
}

/** Playwright storageState JSON → Cookie 헤더 */
export function loadSessionCookieHeader(
  platform: Platform = 'jobkorea',
  alias = ALIAS,
): { path: string; cookieHeader: string; cookieCount: number } {
  const path = sessionStatePath(platform, alias);
  if (!existsSync(path)) {
    throw new Error(`SESSION_MISSING: ${path} — npm run session:refresh 로 세션을 만드세요`);
  }

  const raw = JSON.parse(readFileSync(path, 'utf8')) as StorageState;
  const cookies = (raw.cookies ?? []).filter((c) => {
    if (!c?.name) return false;
    if (typeof c.expires === 'number' && c.expires > 0 && c.expires * 1000 < Date.now()) {
      return false;
    }
    const domain = (c.domain ?? '').replace(/^\./, '');
    return !domain || domain.includes('jobkorea');
  });

  if (cookies.length === 0) {
    throw new Error(`SESSION_EMPTY: ${path}`);
  }

  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { path, cookieHeader, cookieCount: cookies.length };
}
