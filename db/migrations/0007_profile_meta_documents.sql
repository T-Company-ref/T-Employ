-- 0007_profile_meta_documents.sql
-- 인재검색 카드 메타(JSON) + 이력서 문서를 talent_pool 과 연결

ALTER TABLE talent_pool_candidates
  ADD COLUMN IF NOT EXISTS profile_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE candidate_documents
  ADD COLUMN IF NOT EXISTS talent_pool_id uuid REFERENCES talent_pool_candidates(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_talent_pool_profile_meta
  ON talent_pool_candidates USING gin (profile_meta);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_talent
  ON candidate_documents (talent_pool_id)
  WHERE talent_pool_id IS NOT NULL;
