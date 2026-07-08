import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 의존성 없는 최소 .env 로더.
 * 이미 process.env 에 있는 값은 덮어쓰지 않는다 (CI Secrets 우선).
 */
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function bool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export type DbDriver = 'pg' | 'pglite';

export const env = {
  /** DATABASE_URL 이 postgres:// 로 시작하면 hosted pg, 아니면 임베디드 pglite */
  dbDriver: (): DbDriver => {
    const url = process.env.DATABASE_URL ?? '';
    return url.startsWith('postgres://') || url.startsWith('postgresql://') ? 'pg' : 'pglite';
  },
  databaseUrl: () => optional('DATABASE_URL'),
  pgSsl: () => bool('PGSSL', false),
  /** PGlite 데이터 디렉토리 (파일 지속) */
  dataDir: () => optional('PGLITE_DIR', 'data/pgdata'),
  headless: () => bool('HEADLESS', true),
  captureScreenshots: () => bool('CAPTURE_SCREENSHOTS', true),
  platformCreds: (platform: string) => ({
    username: optional(`${platform.toUpperCase()}_USERNAME`),
    password: optional(`${platform.toUpperCase()}_PASSWORD`),
    totpSecret: optional(`${platform.toUpperCase()}_TOTP_SECRET`),
  }),
  smtp: () => ({
    host: optional('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '587')),
    user: optional('SMTP_USER'),
    password: optional('SMTP_PASSWORD'),
    from: optional('MAIL_FROM'),
  }),
  dailyReportRecipients: () =>
    optional('DAILY_REPORT_RECIPIENTS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
};
