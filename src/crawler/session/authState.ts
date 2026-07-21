import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Platform } from '../../db/types.js';

export type AuthSessionStatus = 'active' | 'expired';

export type PlatformAuthState = {
  status: AuthSessionStatus;
  errorNotified: boolean;
  errorAt: string | null;
  errorReason: string | null;
  errorWorkflow: string | null;
  refreshedAt: string | null;
  lastOkAt: string | null;
};

type AuthStateFile = Record<string, PlatformAuthState>;

const FILE = '_auth-state.json';

function authStatePath(): string {
  return resolve(process.cwd(), '.sessions', FILE);
}

function emptyState(): PlatformAuthState {
  return {
    status: 'active',
    errorNotified: false,
    errorAt: null,
    errorReason: null,
    errorWorkflow: null,
    refreshedAt: null,
    lastOkAt: null,
  };
}

function readAll(): AuthStateFile {
  const path = authStatePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AuthStateFile;
  } catch {
    return {};
  }
}

function writeAll(data: AuthStateFile): void {
  const dir = resolve(process.cwd(), '.sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(authStatePath(), JSON.stringify(data, null, 2), 'utf8');
}

export function getAuthState(platform: Platform = 'jobkorea'): PlatformAuthState {
  return { ...emptyState(), ...(readAll()[platform] ?? {}) };
}

export function markSessionOk(platform: Platform = 'jobkorea'): void {
  const all = readAll();
  const prev = all[platform] ?? emptyState();
  all[platform] = {
    ...prev,
    status: 'active',
    errorNotified: false,
    errorAt: null,
    errorReason: null,
    errorWorkflow: null,
    lastOkAt: new Date().toISOString(),
  };
  writeAll(all);
}

export function markSessionRefreshed(platform: Platform = 'jobkorea'): void {
  const all = readAll();
  const prev = all[platform] ?? emptyState();
  all[platform] = {
    ...prev,
    status: 'active',
    errorNotified: false,
    errorAt: null,
    errorReason: null,
    errorWorkflow: null,
    refreshedAt: new Date().toISOString(),
    lastOkAt: new Date().toISOString(),
  };
  writeAll(all);
}

/** 세션 만료 기록. 이미 notified 면 shouldNotify=false */
export function markSessionExpired(
  platform: Platform,
  reason: string,
  workflow: string,
): { shouldNotify: boolean; state: PlatformAuthState } {
  const all = readAll();
  const prev = all[platform] ?? emptyState();
  const already = prev.status === 'expired' && prev.errorNotified;
  const next: PlatformAuthState = {
    ...prev,
    status: 'expired',
    errorNotified: true,
    errorAt: prev.errorAt && already ? prev.errorAt : new Date().toISOString(),
    errorReason: reason.slice(0, 500),
    errorWorkflow: workflow,
  };
  all[platform] = next;
  writeAll(all);
  return { shouldNotify: !already, state: next };
}

export function classifyAuthError(err: unknown): {
  isAuth: boolean;
  isTransient: boolean;
  reason: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';

  if (
    /abort|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(message) ||
    name === 'AbortError'
  ) {
    return { isAuth: false, isTransient: true, reason: message };
  }

  if (
    name === 'SessionExpiredError' ||
    message.startsWith('SESSION_') ||
    /login_page:|SESSION_EXPIRED|SESSION_MISSING|SESSION_EMPTY/i.test(message) ||
    /HTTP_401|HTTP_403/i.test(message) ||
    /login_failed/i.test(message)
  ) {
    return { isAuth: true, isTransient: false, reason: message };
  }

  return { isAuth: false, isTransient: false, reason: message };
}
