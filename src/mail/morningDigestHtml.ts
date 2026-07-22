/**
 * 채용 모닝 다이제스트 HTML
 */
import type { ApplicantAlertRow } from '../db/repositories/applicantAlerts.js';
import type { TalentAlertRow } from '../db/repositories/talentAlerts.js';
import { docsPackHtml } from './docsPackHtml.js';

const TWEMOJI = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg';
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function tw(code: string, alt = '', size = 16): string {
  return `<img src="${TWEMOJI}/${code}.svg" width="${size}" height="${size}" alt="${esc(alt)}" style="vertical-align:-3px;border:0" />`;
}

function fmtHeaderDate(p: KstParts): string {
  return `${p.year}.${pad(p.month)}.${pad(p.day)} (${WEEKDAY_KO[p.weekday]})`;
}

function fmtReportDay(p: KstParts): string {
  return `${pad(p.month)}.${pad(p.day)}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = toKstParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function clean(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b화살표\b/g, '')
    .replace(/[▶►▸▹➔➜➝➞➡⇒⟶→←↑↓]/g, '')
    .trim();
}

function linkBtn(href: string | null | undefined, label: string, variant: 'primary' | 'pdf' | 'ghost' = 'primary'): string {
  if (!href) {
    return `<span style="display:inline-block;padding:6px 10px;border-radius:8px;background:#f3f4f6;color:#9ca3af;font-size:12px;font-weight:600">${esc(label === 'PDF 열기' ? 'PDF 없음' : '—')}</span>`;
  }
  const styles =
    variant === 'pdf'
      ? 'background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8'
      : variant === 'ghost'
        ? 'background:#ffffff;border:1px solid #cbd5e1;color:#334155'
        : 'background:#1e3a8a;border:1px solid #1e3a8a;color:#ffffff';
  return `<a href="${esc(href)}" style="display:inline-block;padding:6px 11px;border-radius:8px;${styles};font-size:12px;font-weight:700;text-decoration:none;line-height:1.2">${esc(label)}</a>`;
}

/** 지원자: 공고 지원자 목록으로 이동 (ResumeDB 직접 링크는 세션/경로 오류) */
function appListHref(item: ApplicantAlertRow): string | null {
  return item.applicantListUrl || null;
}

function skillPills(skills: string[] | undefined): string {
  if (!skills?.length) return '<span style="color:#94a3b8;font-size:12px">—</span>';
  return skills
    .slice(0, 5)
    .map(
      (s) =>
        `<span style="display:inline-block;background:#f5f3ff;color:#6d28d9;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:600;margin:2px 3px 2px 0">${esc(s)}</span>`,
    )
    .join('');
}

function th(label: string, align: 'left' | 'center' = 'left'): string {
  return `<th style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.02em;color:#64748b;text-align:${align};border-bottom:1px solid #e2e8f0">${esc(label)}</th>`;
}

function applicantRows(items: ApplicantAlertRow[], showNew = false): string {
  if (!items.length) {
    return `<tr><td colspan="6" style="padding:22px 12px;color:#94a3b8;text-align:center;font-size:13px">해당 지원자 없음</td></tr>`;
  }
  return items
    .slice(0, 50)
    .map((item, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const badge = showNew
        ? `<span style="display:inline-block;margin-left:6px;padding:2px 6px;border-radius:4px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:800;vertical-align:middle">NEW</span>`
        : '';
      return `<tr style="background:${bg}">
        <td style="padding:12px;font-size:13px;color:#0f172a;border-bottom:1px solid #eef2f7">${esc(item.postingTitle || item.position || '공고 미연결')}</td>
        <td style="padding:12px;font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;border-bottom:1px solid #eef2f7">${esc(item.name || '(이름 없음)')}${badge}</td>
        <td style="padding:12px;font-size:13px;color:#475569;white-space:nowrap;border-bottom:1px solid #eef2f7">${fmtTime(item.appliedAt)}</td>
        <td style="padding:12px;font-size:12px;color:#64748b;border-bottom:1px solid #eef2f7">${esc(item.careerTotal || '—')}</td>
        <td style="padding:12px;border-bottom:1px solid #eef2f7">${docsPackHtml({ resumeUrl: item.pdfUrl, attachments: item.attachments })}</td>
        <td style="padding:12px;text-align:center;border-bottom:1px solid #eef2f7">${linkBtn(appListHref(item), '지원자 목록', 'primary')}</td>
      </tr>`;
    })
    .join('');
}

function talentRows(items: TalentAlertRow[]): string {
  if (!items.length) {
    return `<tr><td colspan="5" style="padding:22px 12px;color:#94a3b8;text-align:center;font-size:13px">해당 인재 없음</td></tr>`;
  }
  return items
    .map((item, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#faf5ff';
      const role = clean((item.roles || [])[0] || item.headline || '—').slice(0, 40);
      const skills = (item.skills || []).map(clean).filter(Boolean);
      return `<tr style="background:${bg}">
        <td style="padding:12px;font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;border-bottom:1px solid #eef2f7">${esc(clean(item.name) || '(이름 없음)')}</td>
        <td style="padding:12px;font-size:12px;color:#334155;border-bottom:1px solid #eef2f7">${esc(role)}</td>
        <td style="padding:12px;font-size:12px;color:#64748b;white-space:nowrap;border-bottom:1px solid #eef2f7">${esc(clean(item.careerText) || '—')}</td>
        <td style="padding:12px;border-bottom:1px solid #eef2f7">${skillPills(skills)}</td>
        <td style="padding:12px;text-align:center;border-bottom:1px solid #eef2f7;white-space:nowrap">
          ${linkBtn(item.profileUrl, '프로필', 'ghost')}
          <span style="display:inline-block;width:6px"></span>
          ${linkBtn(item.pdfUrl, 'PDF 열기', 'pdf')}
        </td>
      </tr>`;
    })
    .join('');
}

function sectionCard(params: {
  accent: string;
  soft: string;
  step: string;
  title: string;
  rangeLabel: string;
  count: number;
  thead: string;
  tbody: string;
}): string {
  return `<div style="margin:0 0 16px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04)">
    <div style="padding:14px 16px;background:linear-gradient(90deg, ${params.soft} 0%, #ffffff 70%);border-bottom:1px solid #eef2f7">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="width:28px;height:28px;border-radius:8px;background:${params.accent};color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:28px">${esc(params.step)}</td>
            <td style="padding-left:10px">
              <div style="font-size:15px;font-weight:800;color:#0f172a">${esc(params.title)}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">${esc(params.rangeLabel)}</div>
            </td>
          </tr></table>
        </td>
        <td align="right" style="vertical-align:middle">
          <span style="display:inline-block;padding:6px 11px;border-radius:999px;background:#ffffff;border:1px solid ${params.accent}33;color:${params.accent};font-size:12px;font-weight:800">총 ${params.count}명</span>
        </td>
      </tr></table>
    </div>
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#f8fafc">${params.thead}</tr></thead>
      <tbody>${params.tbody}</tbody>
    </table>
  </div>`;
}

function kpi(label: string, value: string, sub: string, color: string, soft: string): string {
  return `<td style="width:33.33%;padding:5px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 12px;text-align:center">
      <div style="width:36px;height:36px;border-radius:10px;background:${soft};margin:0 auto 8px;line-height:36px;font-size:14px;font-weight:800;color:${color}">●</div>
      <div style="font-size:12px;color:#64748b;font-weight:600">${esc(label)}</div>
      <div style="margin-top:6px;font-size:28px;font-weight:800;color:${color};letter-spacing:-0.03em">${esc(value)}</div>
      <div style="margin-top:6px;font-size:11px;color:#94a3b8">${esc(sub)}</div>
    </div>
  </td>`;
}

const APP_HEAD = `${th('채용공고')}${th('이름')}${th('지원시각')}${th('경력')}${th('서류')}${th('이동', 'center')}`;
const TALENT_HEAD = `${th('이름')}${th('직무')}${th('경력')}${th('핵심 역량')}${th('프로필 · PDF', 'center')}`;

export function buildMorningDigestHtml(params: {
  slices: DigestReportSlices;
  evening: ApplicantAlertRow[];
  talents: TalentAlertRow[];
  workday: ApplicantAlertRow[];
}): string {
  const { slices, evening, talents, workday } = params;
  const reportDay = fmtReportDay(slices.reportDate);

  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:0;background:#e8eef6;font-family:'Segoe UI',Apple SD Gothic Neo,Malgun Gothic,Arial,sans-serif;color:#0f172a;line-height:1.5">
  <div style="max-width:880px;margin:0 auto;padding:24px 14px 32px">
    <div style="background:linear-gradient(135deg,#0b1f3a 0%,#1e3a8a 55%,#2563eb 100%);border-radius:18px 18px 0 0;padding:26px 24px 22px;color:#fff">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div style="font-size:12px;opacity:0.75;font-weight:600;letter-spacing:0.04em">TBELL EMPLOY</div>
          <div style="margin-top:8px;font-size:22px;font-weight:800;letter-spacing:-0.02em">${tw('1f4e8', '', 22)} 채용 모닝 다이제스트</div>
          <div style="margin-top:8px;font-size:13px;opacity:0.88">전일(${esc(reportDay)}) 채용 현황 요약 · 실시간 미구독자도 이 메일로 전일을 확인할 수 있습니다</div>
        </td>
        <td align="right" style="vertical-align:top">
          <div style="display:inline-block;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,0.12);font-size:13px;font-weight:700;white-space:nowrap">${esc(fmtHeaderDate(slices.sendDate))}</div>
        </td>
      </tr></table>
    </div>

    <div style="background:#f8fafc;border-left:1px solid #dbe3ef;border-right:1px solid #dbe3ef;padding:18px 16px 10px">
      <div style="font-size:13px;font-weight:800;color:#0f172a;margin:0 0 10px 6px">전일 채용 요약</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${kpi('어제 저녁', `${evening.length}명`, slices.evening.rangeLabel, '#2563eb', '#dbeafe')}
        ${kpi('어제 근무중', `${workday.length}명`, slices.workday.rangeLabel, '#059669', '#d1fae5')}
        ${kpi('추천 인재 풀', `${talents.length}명`, '인재풀 신규', '#7c3aed', '#ede9fe')}
      </tr></table>
    </div>

    <div style="background:#eef3f9;border:1px solid #dbe3ef;border-top:0;border-radius:0 0 18px 18px;padding:16px 14px 20px">
      ${sectionCard({
        accent: '#2563eb',
        soft: '#eff6ff',
        step: '1',
        title: slices.evening.title,
        rangeLabel: slices.evening.rangeLabel,
        count: evening.length,
        thead: APP_HEAD,
        tbody: applicantRows(evening, true),
      })}
      ${sectionCard({
        accent: '#059669',
        soft: '#ecfdf5',
        step: '2',
        title: slices.workday.title,
        rangeLabel: slices.workday.rangeLabel,
        count: workday.length,
        thead: APP_HEAD,
        tbody: applicantRows(workday, false),
      })}
      ${sectionCard({
        accent: '#7c3aed',
        soft: '#f5f3ff',
        step: '3',
        title: '추천 인재 풀',
        rangeLabel: '신규 검색',
        count: talents.length,
        thead: TALENT_HEAD,
        tbody: talentRows(talents),
      })}

      <div style="margin-top:6px;padding:14px 16px;border-radius:12px;background:#ffffff;border:1px solid #bfdbfe">
        <div style="font-size:12px;font-weight:800;color:#1d4ed8;margin-bottom:4px">TIP</div>
        <div style="font-size:12px;color:#334155;line-height:1.6">
          지원자 <b>지원자 목록</b>은 잡코리아 해당 공고의 지원자 리스트로 이동합니다.
          지원자 <b>서류</b>란은 이력서 PDF와 첨부(포트폴리오 등) 파일명을 링크로 모아 둡니다. 버튼이 여러 개 생기지 않도록 파일명 텍스트 링크만 사용합니다.
        </div>
      </div>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;text-align:center">TBELL Employ 자동 발송 · 알림 설정은 웹 프로필에서 변경할 수 있습니다.</p>
    </div>
  </div>
  </body></html>`;
}

export function morningDigestSubject(
  slices: DigestReportSlices,
  eveningCount: number,
  talentCount: number,
  workdayCount: number,
): string {
  return `[TBELL] 채용 모닝 다이제스트 · ${fmtHeaderDate(slices.sendDate)} · 저녁 ${eveningCount} · 근무 ${workdayCount} · 인재 ${talentCount}`;
}
