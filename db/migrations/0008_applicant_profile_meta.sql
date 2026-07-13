-- 0008_applicant_profile_meta.sql
-- 지원자 프로필 메타 + 공고 부가 정보

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS profile_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_applications_profile_meta
  ON applications USING gin (profile_meta);
