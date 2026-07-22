/**
 * 메일용 서류 묶음 UI
 * 버튼 나열이 아니라 이력서 1줄 + 첨부 파일명 링크 스택.
 */
export type MailDocLink = {
  name: string;
  url: string;
  kind?: 'resume' | 'attachment';
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 서류 셀: 이력서 · 첨부파일명을 텍스트 링크로 세로 배치 */
export function docsPackHtml(params: {
  resumeUrl?: string | null;
  attachments?: Array<{ name: string; url: string; label?: string | null }>;
}): string {
  const lines: string[] = [];
  if (params.resumeUrl) {
    lines.push(
      `<div style="margin:0 0 4px"><span style="color:#94a3b8;font-size:11px;font-weight:600">이력서</span> · <a href="${esc(params.resumeUrl)}" style="color:#1d4ed8;font-size:12px;font-weight:700;text-decoration:underline">PDF 열기</a></div>`,
    );
  } else {
    lines.push(
      `<div style="margin:0 0 4px"><span style="color:#94a3b8;font-size:11px;font-weight:600">이력서</span> · <span style="color:#cbd5e1;font-size:12px">없음</span></div>`,
    );
  }

  const atts = (params.attachments || []).filter((a) => a.url?.startsWith('http'));
  if (atts.length) {
    const links = atts
      .slice(0, 6)
      .map((a) => {
        const label = (a.label ? `${a.label} · ` : '') + (a.name || '첨부');
        return `<div style="margin:2px 0 0"><a href="${esc(a.url)}" style="color:#0f766e;font-size:12px;font-weight:600;text-decoration:underline;word-break:break-all">${esc(label)}</a></div>`;
      })
      .join('');
    lines.push(
      `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0"><span style="color:#94a3b8;font-size:11px;font-weight:600">첨부 ${atts.length}</span>${links}</div>`,
    );
  }

  return `<div style="text-align:left;line-height:1.35;min-width:120px">${lines.join('')}</div>`;
}
