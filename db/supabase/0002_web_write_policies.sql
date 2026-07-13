-- 0002_web_write_policies.sql (Supabase 전용)
-- Phase 3.5 웹 UI: 소프트 삭제·단계 변경·태그 감사 트리거

-- ---------------------------------------------------------------------------
-- 1) 인증 직원: 후보/지원/인재풀 soft-delete·단계 갱신
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS candidates_update_team ON candidates;
DROP POLICY IF EXISTS applications_update_team ON applications;
DROP POLICY IF EXISTS talent_update_team ON talent_pool_candidates;

CREATE POLICY candidates_update_team ON candidates
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY applications_update_team ON applications
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY talent_update_team ON talent_pool_candidates
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2) 태그 감사 로그: 웹에서 candidate_tags 변경 시 자동 기록
-- ---------------------------------------------------------------------------
ALTER TABLE tag_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_authenticated ON tag_audit_logs;
CREATE POLICY read_authenticated ON tag_audit_logs
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.audit_candidate_tag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  act text;
BEGIN
  actor := public.current_staff_id();
  IF actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    act := 'add';
    INSERT INTO tag_audit_logs (tag_id, action, actor_id, snapshot)
    VALUES (NEW.id, act, actor, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.is_active = false THEN
      act := 'remove';
    ELSE
      act := 'comment_update';
    END IF;
    INSERT INTO tag_audit_logs (tag_id, action, actor_id, snapshot)
    VALUES (NEW.id, act, actor, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_tags_audit ON candidate_tags;
CREATE TRIGGER trg_candidate_tags_audit
  AFTER INSERT OR UPDATE ON candidate_tags
  FOR EACH ROW EXECUTE FUNCTION public.audit_candidate_tag_change();
