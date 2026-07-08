-- 0001_init.sql
-- 공통 트리거, 직원(사용자) 프로필
-- gen_random_uuid() 는 PostgreSQL 13+ 및 PGlite 코어에 내장되어 별도 확장 불필요.

-- updated_at 자동 갱신 트리거 함수
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 페이지 사용자(임원/채용담당/운영자). 추천 태그 및 상태변경 작성자 추적용.
CREATE TABLE staff_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname      text NOT NULL UNIQUE,
  display_name  text,
  email         text UNIQUE,
  role          text NOT NULL DEFAULT 'staff'
                CHECK (role IN ('operator', 'recruiter', 'executive', 'viewer', 'staff')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_staff_profiles_updated
  BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_staff_profiles_active ON staff_profiles (is_active);
