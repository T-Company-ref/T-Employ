-- 0005_crawl.sql
-- 크롤 작업 큐, 실패 로그, 실행 로그

-- 크롤 작업 큐 (동시 실행 제어 + 상태 추적)
CREATE TABLE crawl_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text NOT NULL CHECK (job_type IN ('applicants', 'talent_pool', 'refresh_session')),
  platform      text NOT NULL,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  requested_by  text,                             -- staff nickname 또는 'scheduler'
  trigger_type  text NOT NULL DEFAULT 'manual'
                CHECK (trigger_type IN ('manual', 'schedule')),
  stats         jsonb,                            -- 수집 건수/변경량 요약
  result_json   jsonb,                            -- UI 표시용 결과 요약
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_crawl_jobs_updated
  BEFORE UPDATE ON crawl_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_crawl_jobs_status ON crawl_jobs (status);
CREATE INDEX idx_crawl_jobs_platform ON crawl_jobs (platform);
CREATE INDEX idx_crawl_jobs_created ON crawl_jobs (created_at);

-- 플랫폼별 동시 1건 제약: queued/running 상태는 (job_type, platform) 당 1건만
CREATE UNIQUE INDEX uq_crawl_jobs_active
  ON crawl_jobs (job_type, platform)
  WHERE status IN ('queued', 'running');

-- 실패 원인 분석 (단계/셀렉터/스크린샷)
CREATE TABLE crawl_failures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  platform       text NOT NULL,
  step           text,                            -- 'login' | 'goto_list' | 'collect_detail' ...
  error_code     text,
  error_message  text,
  screenshot_url text,
  html_ref       text,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_failures_job ON crawl_failures (job_id);
CREATE INDEX idx_crawl_failures_platform ON crawl_failures (platform);

-- 실행 로그 (append-only)
CREATE TABLE crawl_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  level      text NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  step       text,
  message    text NOT NULL,
  meta       jsonb,
  logged_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_logs_job ON crawl_logs (job_id);
