-- seed.sql
-- 초기 운영 데이터 (idempotent)

-- 플랫폼 설정
INSERT INTO platform_configs (platform, enabled, priority, crawl_window, rate_limit, route_version)
VALUES
  ('jobkorea', true, 10, '18:00-22:00', 30, '2026-07-07'),
  ('saramin',  true, 20, '18:00-22:00', 30, '2026-07-07')
ON CONFLICT (platform) DO NOTHING;

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
