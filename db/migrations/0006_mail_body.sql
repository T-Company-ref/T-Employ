-- 0006_mail_body.sql
-- mail_jobs 본문 저장 (집계 시점 HTML 보존)

ALTER TABLE mail_jobs ADD COLUMN IF NOT EXISTS body_html text;
