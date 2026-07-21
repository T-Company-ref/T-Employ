-- 인재검색 알림 발송 시각 (모닝 다이제스트 중복 방지)
ALTER TABLE talent_pool_candidates
  ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_talent_pool_alerted_at
  ON talent_pool_candidates (alerted_at)
  WHERE alerted_at IS NULL;
