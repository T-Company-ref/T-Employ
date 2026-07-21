-- seed.sql
-- 초기 운영 데이터 (idempotent)

-- 플랫폼 설정
INSERT INTO platform_configs (platform, enabled, priority, crawl_window, rate_limit, route_version)
VALUES
  ('jobkorea', true, 10, '18:00-22:00', 30, '2026-07-07'),
  ('saramin',  false, 20, '18:00-22:00', 30, '2026-07-07')
ON CONFLICT (platform) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  crawl_window = EXCLUDED.crawl_window,
  rate_limit = EXCLUDED.rate_limit,
  route_version = EXCLUDED.route_version;

-- 플랫폼 헬스 초기 행
INSERT INTO platform_health (platform, status)
VALUES ('jobkorea', 'unknown'), ('saramin', 'unknown')
ON CONFLICT (platform) DO NOTHING;

-- 플랫폼 운영 계정 (비밀번호는 Secrets에서 조회, 여기엔 alias만)
INSERT INTO platform_accounts (platform, account_alias, login_policy, is_active, note)
VALUES
  ('jobkorea', 'tbell-corp', 'session_reuse', true, '잡코리아 기업계정'),
  ('saramin',  'tbell-corp', 'session_reuse', true, '사람인 기업계정')
ON CONFLICT (platform, account_alias) DO NOTHING;

-- 샘플 운영자 (닉네임 기반, 추후 실명 전환 가능)
INSERT INTO staff_profiles (nickname, display_name, role)
VALUES ('admin', '운영자', 'operator')
ON CONFLICT (nickname) DO NOTHING;

-- 웹 로그인용 운영자 (Supabase Auth 이메일과 매칭 → auth_user_id 트리거로 연결)
INSERT INTO staff_profiles (nickname, display_name, email, role)
VALUES ('yj.kim', '김영진', 'yj.kim@tbell.co.kr', 'operator')
ON CONFLICT (nickname) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role;

INSERT INTO staff_profiles (nickname, display_name, email, role)
VALUES
  ('jonghyuk.kim', '김종혁', 'jonghyuk.kim@tbell.co.kr', 'viewer'),
  ('hj.joo', '주현진', 'hj.joo@tbell.co.kr', 'viewer')
ON CONFLICT (nickname) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role;
