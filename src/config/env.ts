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

function normalizeAppPassword(value: string): string {
  // Google 앱 비밀번호는 "abcd efgh ijkl mnop" 형태 — 공백 제거
  return value.replace(/\s+/g, '');
}

function parseMailFrom(raw: string): { name?: string; email: string } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, '');
    return { name: name || undefined, email: m[2].trim() };
  }
  return { email: trimmed };
}

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
  /** Phase 1 수집 상한 (플랫폼당) */
  crawlMaxItems: () => Math.max(1, Number(optional('CRAWL_MAX_ITEMS', '20')) || 20),
  /** 크롤 시 상세 진입 후 이력서 PDF 수집 */
  crawlFetchResumes: () => bool('CRAWL_FETCH_RESUMES', true),
  supabaseUrl: () => optional('SUPABASE_URL'),
  supabaseServiceRoleKey: () => optional('SUPABASE_SERVICE_ROLE_KEY'),
  resumeStorageBucket: () => optional('RESUME_STORAGE_BUCKET', 'resumes'),
  /** Phase 2: cron 자동 실행 제어 (로컬 기본 false) */
  autoCrawlEnabled: () => bool('AUTO_CRAWL_ENABLED', false),
  platformCreds: (platform: string) => ({
    username: optional(`${platform.toUpperCase()}_USERNAME`),
    password: optional(`${platform.toUpperCase()}_PASSWORD`),
    totpSecret: optional(`${platform.toUpperCase()}_TOTP_SECRET`),
  }),
  /** Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD + MAIL_FROM) */
  gmail: () => ({
    user: optional('GMAIL_USER') || optional('SMTP_USER'),
    appPassword: normalizeAppPassword(
      optional('GMAIL_APP_PASSWORD') || optional('SMTP_PASSWORD'),
    ),
  }),
  gmailReady: (): boolean => {
    const g = env.gmail();
    return Boolean(g.user && g.appPassword);
  },
  /** Resend API (tbell.co.kr 등 인증 도메인 발신 시) */
  resend: () => ({
    apiKey: optional('RESEND_API_KEY'),
    /**
     * Resend 인증 도메인 주소만 가능 (@gmail.com 불가).
     * 예: T-Employ <noreply@tbell.co.kr>
     * 테스트: onboarding@resend.dev (Resend 계정 이메일로만 수신 가능)
     */
    from: optional('RESEND_FROM', 'T-Employ <noreply@tbell.co.kr>'),
    replyTo: optional('RESEND_REPLY_TO'),
  }),
  /** 발신 표시 문자열 */
  mailFrom: (): string => {
    if (env.gmailReady()) return env.smtp().from;
    if (optional('RESEND_API_KEY')) {
      return optional('RESEND_FROM', 'T-Employ <noreply@tbell.co.kr>');
    }
    return env.smtp().from;
  },
  /** Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD + MAIL_FROM) */
  smtp: () => {
    const user = optional('GMAIL_USER') || optional('SMTP_USER');
    const isGmail = user.toLowerCase().endsWith('@gmail.com');
    const host = optional('SMTP_HOST') || (isGmail ? 'smtp.gmail.com' : '');
    const password = normalizeAppPassword(
      optional('GMAIL_APP_PASSWORD') || optional('SMTP_PASSWORD'),
    );

    const mailFromRaw = optional('MAIL_FROM');
    let fromEmail = mailFromRaw ? parseMailFrom(mailFromRaw).email : user;
    let fromName = optional('MAIL_FROM_NAME', 'T-Employ');
    if (mailFromRaw) {
      const parsed = parseMailFrom(mailFromRaw);
      fromEmail = parsed.email || fromEmail;
      if (parsed.name) fromName = parsed.name;
    }
    if (!fromEmail) fromEmail = 'noreply@tbell.co.kr';

    const from = fromName
      ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>`
      : fromEmail;

    return {
      host,
      port: Number(optional('SMTP_PORT', '587')),
      user,
      password,
      fromEmail,
      fromName,
      from,
      isGmail,
    };
  },
  /** GitHub Actions 실행 결과 알림 수신자 (항상 포함) */
  actionNotifyEmails: (): string[] => {
    const defaults = ['yj.kim@tbell.co.kr'];
    const extra = optional('ACTION_NOTIFY_EMAIL')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([...defaults, ...extra])];
  },
  /** 일일 요약 메일 수신자 */
  dailyReportRecipients: (): string[] => {
    const defaults = ['yj.kim@tbell.co.kr'];
    const extra = optional('DAILY_REPORT_RECIPIENTS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([...defaults, ...extra])];
  },
};
