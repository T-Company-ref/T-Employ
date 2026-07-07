-- 0004_collaboration.sql
-- 추천 태그(작성자 추적), 상태 이력, 면접 이벤트, 메일 작업

-- 추천/관심 태그 (누가 달았는지 staff_id로 추적)
CREATE TABLE candidate_tags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type      text NOT NULL CHECK (target_type IN ('applicant', 'talent_pool')),
  target_id        uuid NOT NULL,                 -- applications.id 또는 talent_pool_candidates.id
  tag_type         text NOT NULL DEFAULT 'recommend'
                   CHECK (tag_type IN ('recommend', 'watch', 'flag')),
  comment          text,
  tagged_by        uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  tagged_at        timestamptz NOT NULL DEFAULT now(),
  is_active        boolean NOT NULL DEFAULT true,
  -- 동일 대상에 동일 사용자가 동일 타입 태그 중복 금지
  UNIQUE (target_type, target_id, tag_type, tagged_by)
);

CREATE INDEX idx_candidate_tags_target ON candidate_tags (target_type, target_id);
CREATE INDEX idx_candidate_tags_by ON candidate_tags (tagged_by);

-- 태그 변경 이력 (추가/제거 감사 로그)
CREATE TABLE tag_audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id     uuid REFERENCES candidate_tags(id) ON DELETE SET NULL,
  action     text NOT NULL CHECK (action IN ('add', 'remove', 'comment_update')),
  actor_id   uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  snapshot   jsonb,
  acted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tag_audit_tag ON tag_audit_logs (tag_id);

-- 후보자 상태 변경 이력 (append-only, 작성자 추적)
CREATE TABLE candidate_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  status_code   text NOT NULL CHECK (status_code IN (
                  'applied', 'screening_pass', 'interviewing',
                  'interview_scheduled', 'interview_pass', 'interview_fail', 'interview_no_show',
                  'offer', 'hired', 'rejected', 'closed_lost', 'employed_elsewhere', 'blocked'
                )),
  reason        text,
  changed_by    uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_history_candidate ON candidate_status_history (candidate_id);
CREATE INDEX idx_status_history_changed_at ON candidate_status_history (changed_at);

-- 면접 일정/결과 관리
CREATE TABLE interview_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  interview_at  timestamptz,
  interviewer   text,
  meeting_type  text NOT NULL DEFAULT 'onsite'
                CHECK (meeting_type IN ('onsite', 'online', 'phone')),
  result        text NOT NULL DEFAULT 'scheduled'
                CHECK (result IN ('scheduled', 'pass', 'fail', 'no_show', 'canceled')),
  hired_start_date date,                          -- 입사일(작성 시 완료 처리 근거)
  note          text,
  created_by    uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_interview_events_updated
  BEFORE UPDATE ON interview_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_interview_candidate ON interview_events (candidate_id);
CREATE INDEX idx_interview_at ON interview_events (interview_at);

-- 메일 발송 작업 (개별 발송 + 일일 요약)
CREATE TABLE mail_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_type     text NOT NULL DEFAULT 'candidate'
                CHECK (mail_type IN ('candidate', 'daily_report')),
  candidate_id  uuid REFERENCES candidates(id) ON DELETE SET NULL,
  template_id   text,
  recipients    text[] NOT NULL DEFAULT '{}',
  subject       text,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'retry')),
  attempt_count integer NOT NULL DEFAULT 0,
  error         text,
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_mail_jobs_updated
  BEFORE UPDATE ON mail_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_mail_jobs_status ON mail_jobs (status);
CREATE INDEX idx_mail_jobs_type ON mail_jobs (mail_type);
