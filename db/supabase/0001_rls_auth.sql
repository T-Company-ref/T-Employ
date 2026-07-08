-- 0001_rls_auth.sql  (Supabase 전용)
-- 실행 시점: db/migrations/0001~0005 적용 후, Supabase에서만 실행한다.
--            (auth 스키마/auth.uid() 는 Supabase 전용이라 PGlite 체인에는 포함하지 않는다.)
-- 목적: 기업 이메일 로그인(Auth) → staff_profiles 매핑, RLS 기반 접근 제어.
-- 주의: service_role 키 및 DB superuser(postgres) 연결은 RLS를 우회한다 → 크롤러(Actions)는 영향 없음.

-- ---------------------------------------------------------------------------
-- 1) auth.users → staff_profiles 매핑
-- ---------------------------------------------------------------------------
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;

-- 신규 로그인 사용자를 staff_profiles 로 연결(있으면 이메일로 링크, 없으면 생성)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE staff_profiles
     SET auth_user_id = NEW.id
   WHERE email = NEW.email
     AND auth_user_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO staff_profiles (auth_user_id, email, nickname, display_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      split_part(NEW.email, '@', 1),
      split_part(NEW.email, '@', 1),
      'viewer'   -- 기본 권한: 조회. 승격은 운영자가 수동 처리.
    )
    ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 현재 로그인 사용자의 staff_profiles.id
CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM staff_profiles WHERE auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 2) RLS 활성화
-- ---------------------------------------------------------------------------
ALTER TABLE staff_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_postings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE talent_pool_candidates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_tags           ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_events         ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) 조회 정책 (인증된 직원 전체 허용) — 재실행 가능하도록 DROP 후 CREATE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS read_authenticated ON staff_profiles;
DROP POLICY IF EXISTS read_authenticated ON job_postings;
DROP POLICY IF EXISTS read_authenticated ON candidates;
DROP POLICY IF EXISTS read_authenticated ON applications;
DROP POLICY IF EXISTS read_authenticated ON candidate_documents;
DROP POLICY IF EXISTS read_authenticated ON talent_pool_candidates;
DROP POLICY IF EXISTS read_authenticated ON candidate_tags;
DROP POLICY IF EXISTS read_authenticated ON candidate_status_history;
DROP POLICY IF EXISTS read_authenticated ON interview_events;

CREATE POLICY read_authenticated ON staff_profiles           FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON job_postings             FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON candidates               FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON applications             FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON candidate_documents      FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON talent_pool_candidates   FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON candidate_tags           FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON candidate_status_history FOR SELECT TO authenticated USING (true);
CREATE POLICY read_authenticated ON interview_events         FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 4) 협업 쓰기 정책 (본인 actor 기록만 생성/수정, 물리 삭제 없음)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tag_insert_self ON candidate_tags;
DROP POLICY IF EXISTS tag_update_self ON candidate_tags;
DROP POLICY IF EXISTS status_insert_self ON candidate_status_history;
DROP POLICY IF EXISTS interview_insert_self ON interview_events;
DROP POLICY IF EXISTS interview_update_team ON interview_events;
DROP POLICY IF EXISTS staff_update_self ON staff_profiles;

-- 추천 태그: 본인 명의로만 생성/수정 (삭제 정책 없음 → is_active=false 소프트 삭제 사용)
CREATE POLICY tag_insert_self ON candidate_tags
  FOR INSERT TO authenticated
  WITH CHECK (tagged_by = public.current_staff_id());
CREATE POLICY tag_update_self ON candidate_tags
  FOR UPDATE TO authenticated
  USING (tagged_by = public.current_staff_id())
  WITH CHECK (tagged_by = public.current_staff_id());

-- 상태 이력: append-only, 본인 명의로만 추가 (수정/삭제 정책 없음)
CREATE POLICY status_insert_self ON candidate_status_history
  FOR INSERT TO authenticated
  WITH CHECK (changed_by = public.current_staff_id());

-- 면접 이벤트: 본인 명의로 생성, 팀 협업 위해 인증 직원 수정 허용 (삭제는 canceled 상태로 처리)
CREATE POLICY interview_insert_self ON interview_events
  FOR INSERT TO authenticated
  WITH CHECK (created_by = public.current_staff_id());
CREATE POLICY interview_update_team ON interview_events
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- staff_profiles: 본인 프로필만 수정 (역할 변경은 service_role/운영자 콘솔에서)
CREATE POLICY staff_update_self ON staff_profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- 참고: 위 정책은 초안이다. 역할별(operator/recruiter/executive/viewer) 세분화는
--       실제 운영 규칙 확정 후 조정한다. 삭제(블락)는 상태 컬럼(soft delete)으로만 수행한다.
