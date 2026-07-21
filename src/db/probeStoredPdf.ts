import { MIN_RESUME_PDF_BYTES } from '../crawler/resume/jobkoreaResume.js';

export type StoredPdfProbe =
  | { status: 'ok'; bytes: number }
  | { status: 'missing' } // 404 등 — 재수집 필요
  | { status: 'too_small'; bytes: number }
  | { status: 'unknown' }; // 네트워크/헤더 불명 — 기존 PDF 유지

/** 저장된 PDF URL 상태. unknown 이면 재수집하지 말 것 (정상 파일 덮어쓰기 방지). */
export async function probeStoredPdf(url: string): Promise<StoredPdfProbe> {
  if (!url.startsWith('http')) return { status: 'missing' };

  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.status === 404 || head.status === 410) return { status: 'missing' };
    const headLen = Number(head.headers.get('content-length') || '');
    if (Number.isFinite(headLen) && headLen > 0) {
      if (headLen < MIN_RESUME_PDF_BYTES) return { status: 'too_small', bytes: headLen };
      return { status: 'ok', bytes: headLen };
    }
  } catch {
    // fall through to GET probe
  }

  try {
    const get = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    if (get.status === 404 || get.status === 410) return { status: 'missing' };
    if (!get.ok && get.status !== 206) return { status: 'unknown' };

    const total = get.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1];
    const len = Number(total || get.headers.get('content-length') || '');
    if (Number.isFinite(len) && len > 0) {
      if (len < MIN_RESUME_PDF_BYTES) return { status: 'too_small', bytes: len };
      return { status: 'ok', bytes: len };
    }
    return { status: 'unknown' };
  } catch {
    return { status: 'unknown' };
  }
}

export function needsPdfRefetch(probe: StoredPdfProbe): boolean {
  return probe.status === 'missing' || probe.status === 'too_small';
}
