-- 0012_categories_and_doc_source.sql
-- 공고/인재 카테고리 + 첨부파일(포트폴리오) 원본 메타

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE talent_pool_candidates
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE candidate_documents
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS source_label text;

CREATE INDEX IF NOT EXISTS idx_job_postings_category
  ON job_postings (category);

CREATE INDEX IF NOT EXISTS idx_talent_pool_category
  ON talent_pool_candidates (category);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_app_type
  ON candidate_documents (application_id, doc_type);
