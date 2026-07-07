-- 0003_recruiting.sql
-- 공고, 공고 스냅샷, 후보자, 공고 지원 이력, 문서, 인재검색 후보

-- 자사 공고 원문
CREATE TABLE job_postings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text NOT NULL,
  external_posting_id text NOT NULL,
  title               text NOT NULL,
  content_html        text,
  source_url          text,
  opened_at           timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_posting_id)
);

CREATE TRIGGER trg_job_postings_updated
  BEFORE UPDATE ON job_postings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 공고 스냅샷 (링크 만료 대비 이미지/문서 이중 보관)
CREATE TABLE posting_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id  uuid NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  image_url   text,
  html_ref    text,
  content_hash text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_posting_snapshots_posting ON posting_snapshots (posting_id);

-- 후보자 마스터 (동일 인물 단일 레코드)
CREATE TABLE candidates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text,
  email        text,
  phone        text,
  -- 출처 유형: 공고지원 / 인재검색
  source_type  text NOT NULL DEFAULT 'applicant'
               CHECK (source_type IN ('applicant', 'talent_pool')),
  is_active    boolean NOT NULL DEFAULT true,   -- 소프트 삭제 플래그
  merged_into  uuid REFERENCES candidates(id) ON DELETE SET NULL, -- 중복 병합 대상
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_candidates_updated
  BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 중복 병합 규칙(이메일 > 전화 > 프로필URL)을 위한 부분 유니크 인덱스
CREATE UNIQUE INDEX uq_candidates_email
  ON candidates (lower(email)) WHERE email IS NOT NULL AND merged_into IS NULL;
CREATE INDEX idx_candidates_phone ON candidates (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_candidates_active ON candidates (is_active);

-- 공고 지원 이력 (후보자 1 : N 지원)
CREATE TABLE applications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  posting_id     uuid REFERENCES job_postings(id) ON DELETE SET NULL,
  platform       text NOT NULL,
  applied_at     timestamptz NOT NULL,
  current_stage  text NOT NULL DEFAULT 'applied'
                 CHECK (current_stage IN (
                   'applied', 'screening_pass', 'interviewing',
                   'interview_rejected', 'offer', 'hired',
                   'closed_lost', 'employed_elsewhere', 'blocked'
                 )),
  is_active      boolean NOT NULL DEFAULT true,   -- 소프트 삭제
  external_ref   text,                            -- 플랫폼 원본 식별자
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_ref)
);

CREATE TRIGGER trg_applications_updated
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_applications_candidate ON applications (candidate_id);
CREATE INDEX idx_applications_posting ON applications (posting_id);
CREATE INDEX idx_applications_applied_at ON applications (applied_at);
CREATE INDEX idx_applications_stage ON applications (current_stage);

-- 지원서/이력서 문서 (PDF 원본 + 파싱 텍스트)
CREATE TABLE candidate_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id   uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  doc_type       text NOT NULL DEFAULT 'resume'
                 CHECK (doc_type IN ('resume', 'cover_letter', 'portfolio', 'other')),
  file_url       text,
  file_hash      text,                            -- 해시 기반 중복 제거
  parsed_text    text,
  collected_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidate_documents_candidate ON candidate_documents (candidate_id);
CREATE UNIQUE INDEX uq_candidate_documents_hash
  ON candidate_documents (file_hash) WHERE file_hash IS NOT NULL;

-- 인재검색/포지션 제안 후보 (공고 지원자와 분리 운영)
CREATE TABLE talent_pool_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id     uuid REFERENCES candidates(id) ON DELETE SET NULL,
  platform         text NOT NULL,
  profile_url      text,
  profile_ref      text,                          -- 플랫폼 원본 식별자
  search_condition text,                          -- 검색 조건(키워드/필터)
  headline         text,
  summary_text     text,
  proposal_status  text NOT NULL DEFAULT 'sourced'
                   CHECK (proposal_status IN (
                     'sourced', 'proposed', 'accepted', 'declined', 'no_response', 'blocked'
                   )),
  is_active        boolean NOT NULL DEFAULT true, -- 소프트 삭제
  sourced_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, profile_ref)
);

CREATE TRIGGER trg_talent_pool_updated
  BEFORE UPDATE ON talent_pool_candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_talent_pool_platform ON talent_pool_candidates (platform);
CREATE INDEX idx_talent_pool_status ON talent_pool_candidates (proposal_status);
CREATE INDEX idx_talent_pool_sourced_at ON talent_pool_candidates (sourced_at);
