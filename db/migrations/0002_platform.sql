-- 0002_platform.sql
-- 플랫폼 계정/세션/설정/경로/헬스 (멀티 사이트 확장 기반)

-- 플랫폼 운영 계정 (개인계정 금지, 전용 운영계정만)
CREATE TABLE platform_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform       text NOT NULL,               -- 'jobkorea' | 'saramin' | ...
  account_alias  text NOT NULL,               -- 계정 식별자(비밀번호는 저장하지 않음, Secrets에서 조회)
  login_policy   text NOT NULL DEFAULT 'session_reuse'
                 CHECK (login_policy IN ('session_reuse', 'always_login', 'manual_only')),
  is_active      boolean NOT NULL DEFAULT true,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, account_alias)
);

CREATE TRIGGER trg_platform_accounts_updated
  BEFORE UPDATE ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 세션 상태 추적 (storageState 자체는 파일/스토리지, 여기엔 메타만)
CREATE TABLE platform_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform         text NOT NULL,
  account_alias    text NOT NULL,
  session_version  integer NOT NULL DEFAULT 1,
  storage_ref      text,                       -- 암호화 세션 파일 경로/스토리지 키
  status           text NOT NULL DEFAULT 'unknown'
                   CHECK (status IN ('valid', 'expired', 'blocked', 'unknown')),
  expires_at       timestamptz,
  last_check_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, account_alias)
);

CREATE TRIGGER trg_platform_sessions_updated
  BEFORE UPDATE ON platform_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 사이트 실행 설정 (설정 기반 온보딩/on-off)
CREATE TABLE platform_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      text NOT NULL UNIQUE,
  enabled       boolean NOT NULL DEFAULT true,
  priority      integer NOT NULL DEFAULT 100,  -- 낮을수록 먼저 실행
  crawl_window  text,                          -- 예: '18:00-22:00'
  rate_limit    integer NOT NULL DEFAULT 30,   -- 분당 요청 수
  timeout_ms    integer NOT NULL DEFAULT 30000,
  max_retries   integer NOT NULL DEFAULT 2,
  route_version text,                           -- 현재 사용중인 Route Map 버전
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_platform_configs_updated
  BEFORE UPDATE ON platform_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 사이트 경로/셀렉터 버전 관리 (UI 변경 대응)
CREATE TABLE platform_routes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          text NOT NULL,
  route_name        text NOT NULL,             -- 'home' | 'applicants_list' | 'talent_pool_list' ...
  selector_version  text NOT NULL,
  config_ref        text,                       -- config/routes/*.yaml 참조 키
  is_active         boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, route_name, selector_version)
);

-- 사이트 상태 모니터링
CREATE TABLE platform_health (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform       text NOT NULL UNIQUE,
  last_ok_at     timestamptz,
  fail_count_24h integer NOT NULL DEFAULT 0,
  last_error     text,
  status         text NOT NULL DEFAULT 'unknown'
                 CHECK (status IN ('ok', 'warn', 'fail', 'unknown')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_platform_health_updated
  BEFORE UPDATE ON platform_health
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
