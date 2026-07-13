-- 0003_storage_resumes.sql (Supabase 전용)
-- 이력서 PDF Storage 버킷 + 인증 사용자 읽기

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  true,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS resumes_public_read ON storage.objects;
CREATE POLICY resumes_public_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'resumes');
