-- 0011_staff_recommender_notify.sql
-- 추천자(recommender) 역할 + 알림 수신 설정(notify_pref)

ALTER TABLE staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_role_check;
ALTER TABLE staff_profiles
  ADD CONSTRAINT staff_profiles_role_check
  CHECK (role IN ('operator', 'recruiter', 'executive', 'viewer', 'staff', 'recommender'));

ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS notify_pref text NOT NULL DEFAULT 'none';

ALTER TABLE staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_notify_pref_check;
ALTER TABLE staff_profiles
  ADD CONSTRAINT staff_profiles_notify_pref_check
  CHECK (notify_pref IN ('none', 'digest', 'realtime'));

COMMENT ON COLUMN staff_profiles.notify_pref IS
  'none=알림 없음, digest=아침 다이제스트만, realtime=실시간+다이제스트';

-- 표시명·역할 보정 (추천자)
UPDATE staff_profiles
SET display_name = '김종혁',
    role = 'recommender',
    notify_pref = COALESCE(NULLIF(notify_pref, 'none'), 'digest')
WHERE lower(email) = 'jonghyuk.kim@tbell.co.kr';

UPDATE staff_profiles
SET display_name = '주호정',
    role = 'recommender',
    notify_pref = COALESCE(NULLIF(notify_pref, 'none'), 'digest')
WHERE lower(email) = 'hj.joo@tbell.co.kr';

INSERT INTO staff_profiles (nickname, display_name, email, role, notify_pref, is_active)
VALUES ('yh.park', 'yh.park', 'yh.park@tbell.co.kr', 'recommender', 'digest', true)
ON CONFLICT (nickname) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  notify_pref = EXCLUDED.notify_pref,
  is_active = true;

-- 기존 operator 는 실시간 알림 기본
UPDATE staff_profiles
SET notify_pref = 'realtime'
WHERE role = 'operator' AND notify_pref = 'none';
