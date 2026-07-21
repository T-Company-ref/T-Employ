import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

export interface StoredFile {
  fileUrl: string;
  fileHash: string;
  localPath?: string;
}

/** Supabase Storage 또는 로컬 data/resumes 에 PDF 저장 */
export async function storeResumePdf(params: {
  platform: string;
  ref: string;
  pdf: Buffer;
}): Promise<StoredFile> {
  const fileHash = createHash('sha256').update(params.pdf).digest('hex');
  // 해시 경로: 재수집 시 다른 내용으로 같은 ref 를 덮어쓰지 않음 (기존 정상 PDF 보존)
  const objectPath = `${params.platform}/${params.ref}-${fileHash.slice(0, 16)}.pdf`;

  const supabaseUrl = env.supabaseUrl();
  const serviceKey = env.supabaseServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'resume_storage_not_configured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 .env 에 설정하세요 (웹 다운로드용)',
    );
  }

  // 버킷 없으면 생성 시도
  await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: 'resumes',
      name: 'resumes',
      public: true,
      file_size_limit: 10_485_760,
      allowed_mime_types: ['application/pdf'],
    }),
  }).catch(() => undefined);

  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/resumes/${objectPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: new Uint8Array(params.pdf),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`storage_upload_failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/resumes/${objectPath}`;
  return { fileUrl: publicUrl, fileHash };
}

export function resumeStorageReady(): boolean {
  return Boolean(env.supabaseUrl() && env.supabaseServiceRoleKey());
}
