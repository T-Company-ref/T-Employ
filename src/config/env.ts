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

function parseMailFrom(raw: string): { name?: string; email: string } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, '');
    return { name: name || undefined, email: m[2].trim() };
  }
  return { email: trimmed };
}

function normalizeAppPassword(value: string): string {
  return value.replace(/\s+/g, '');
}

const DEFAULT_NOTIFY_EMAIL = 'yj.kim@tbell.co.kr';

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
  /** Phase 1 수집 상한 (지원자 폴링/크롤 플랫폼당) */
  crawlMaxItems: () => Math.max(1, Number(optional('CRAWL_MAX_ITEMS', '50')) || 50),
  /** 인재검색 일일 수집 상한 (사이트당, 기본 5 — 지원자 CRAWL_MAX_ITEMS 와 분리) */
  talentCrawlMaxItems: () => Math.max(1, Number(optional('TALENT_CRAWL_MAX_ITEMS', '5')) || 5),
  /** 크롤 시 상세 진입 후 이력서 PDF 수집 */
  crawlFetchResumes: () => bool('CRAWL_FETCH_RESUMES', true),
  supabaseUrl: () => optional('SUPABASE_URL'),
  supabaseServiceRoleKey: () => optional('SUPABASE_SERVICE_ROLE_KEY'),
  resumeStorageBucket: () => optional('RESUME_STORAGE_BUCKET', 'resumes'),
  /** 웹 UI 베이스 URL (메일 '자세히 보기' 링크) */
  webAppUrl: () => optional('WEB_APP_URL', 'https://t-company-ref.github.io/T-Employ/').replace(/\/?$/, '/'),
  /** Phase 2: cron 자동 실행 제어 (로컬 기본 false) */
  autoCrawlEnabled: () => bool('AUTO_CRAWL_ENABLED', false),
  platformCreds: (platform: string) => ({
    username: optional(`${platform.toUpperCase()}_USERNAME`),
    password: optional(`${platform.toUpperCase()}_PASSWORD`),
    totpSecret: optional(`${platform.toUpperCase()}_TOTP_SECRET`),
  }),
  /** Gmail SMTP */
  gmail: () => ({
    user: optional('GMAIL_USER') || optional('SMTP_USER'),
    appPassword: normalizeAppPassword(
      optional('GMAIL_APP_PASSWORD') || optional('SMTP_PASSWORD'),
    ),
  }),
  gmailReady: (): boolean => {
    const g = env.gmail();
    return Boolean(g.user && g.appPassword && env.mailFrom());
  },
  /**
   * 발신 표시.
   * - MAIL_FROM=`T-Employ <tbell.wr@gmail.com>` 형태 권장
   * - 또는 MAIL_FROM=이메일 + MAIL_FROM_NAME=표시명
   */
  mailFrom: (): string => {
    const mailFromRaw = optional('MAIL_FROM');
    const fromName = optional('MAIL_FROM_NAME', 'T-Employ');
    const user = optional('GMAIL_USER') || optional('SMTP_USER');

    if (mailFromRaw) {
      const parsed = parseMailFrom(mailFromRaw);
      const email = parsed.email || user;
      const name = parsed.name || fromName;
      if (!email) return '';
      return `${name.replace(/[<>]/g, '')} <${email}>`;
    }
    if (user) return `${fromName.replace(/[<>]/g, '')} <${user}>`;
    return '';
  },
  smtp: () => {
    const user = optional('GMAIL_USER') || optional('SMTP_USER');
    const isGmail = user.toLowerCase().endsWith('@gmail.com');
    const host = optional('SMTP_HOST') || (isGmail ? 'smtp.gmail.com' : '');
    const password = normalizeAppPassword(
      optional('GMAIL_APP_PASSWORD') || optional('SMTP_PASSWORD'),
    );
    return {
      host,
      port: Number(optional('SMTP_PORT', '587')),
      user,
      password,
      from: env.mailFrom(),
      isGmail,
    };
  },
  mailReady: (): boolean => env.gmailReady(),
  /**
   * 운영/인증 오류 알림 수신자.
   * ACTION_NOTIFY_EMAIL (Actions Variable 권장), 없으면 yj.kim@tbell.co.kr
   */
  actionNotifyEmails: (): string[] => {
    const raw = optional('ACTION_NOTIFY_EMAIL', DEFAULT_NOTIFY_EMAIL);
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? [...new Set(list)] : [DEFAULT_NOTIFY_EMAIL];
  },
  dailyReportRecipients: (): string[] => {
    const extra = optional('DAILY_REPORT_RECIPIENTS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (extra.length > 0) return [...new Set(extra)];
    return env.actionNotifyEmails();
  },
};
