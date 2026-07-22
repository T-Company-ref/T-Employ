import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

export interface StoredFile {
  fileUrl: string;
  fileHash: string;
  localPath?: string;
}

function extFor(fileName?: string, contentType?: string): string {
  const fromName = fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (contentType?.includes('wordprocessingml')) return 'docx';
  if (contentType?.includes('msword')) return 'doc';
  if (contentType?.includes('zip')) return 'zip';
  if (contentType?.includes('jpeg')) return 'jpg';
  if (contentType?.includes('png')) return 'png';
  return 'pdf';
}

function mimeFor(ext: string, contentType?: string): string {
  if (contentType) return contentType;
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'zip':
      return 'application/zip';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

/** Supabase Storage 에 이력서/첨부 저장 (기본 PDF) */
export async function storeResumePdf(params: {
  platform: string;
  ref: string;
  pdf: Buffer;
  fileName?: string;
  contentType?: string;
}): Promise<StoredFile> {
  const fileHash = createHash('sha256').update(params.pdf).digest('hex');
  const ext = extFor(params.fileName, params.contentType);
  // 해시 경로: 재수집 시 다른 내용으로 같은 ref 를 덮어쓰지 않음 (기존 정상 PDF 보존)
  const objectPath = `${params.platform}/${params.ref}-${fileHash.slice(0, 16)}.${ext}`;
  const contentType = mimeFor(ext, params.contentType);

  const supabaseUrl = env.supabaseUrl();
  const serviceKey = env.supabaseServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'resume_storage_not_configured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 .env 에 설정하세요 (웹 다운로드용)',
    );
  }

  const bucketBody = {
    id: 'resumes',
    name: 'resumes',
    public: true,
    file_size_limit: 52_428_800,
    allowed_mime_types: [
      'application/pdf',
      'application/octet-stream',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
      'image/jpeg',
      'image/png',
    ],
  };
  // 버킷 없으면 생성, 있으면 용량/MIME 한도 갱신
  await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bucketBody),
  }).catch(() => undefined);
  await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/bucket/resumes`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      public: true,
      file_size_limit: bucketBody.file_size_limit,
      allowed_mime_types: bucketBody.allowed_mime_types,
    }),
  }).catch(() => undefined);

  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/resumes/${objectPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
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
