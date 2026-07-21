-- 지원자 알림 발송 시각 (실시간/모닝 다이제스트 중복 방지)
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_alerted_at
  ON applications (alerted_at)
  WHERE alerted_at IS NULL;
