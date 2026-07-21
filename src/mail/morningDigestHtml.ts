/**
 * 채용 모닝 다이제스트 HTML (참고 시안 기반)
 */
import type { ApplicantAlertRow } from '../db/repositories/applicantAlerts.js';
import type { TalentAlertRow } from '../db/repositories/talentAlerts.js';
import type { DigestReportSlices, KstParts } from './notifySchedule.js';
import { toKstParts } from './notifySchedule.js';
import { env } from '../config/env.js';

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

function pdfCell(pdfUrl: string | null | undefined): string {
  if (!pdfUrl) return `<span style="color:#9ca3af;font-size:12px">없음</span>`;
  return `<a href="${esc(pdfUrl)}" style="display:inline-block;padding:5px 9px;border-radius:7px;background:#dbeafe;border:1px solid #93c5fd;color:#1d4ed8;font-size:12px;font-weight:700;text-decoration:none">PDF 열기</a>`;
}

function detailBtn(href: string | null | undefined, label = '자세히 보기'): string {
  if (!href) return `<span style="color:#9ca3af;font-size:12px">—</span>`;
  return `<a href="${esc(href)}" style="display:inline-block;padding:5px 10px;border-radius:7px;background:#1e3a8a;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none">${esc(label)}</a>`;
}

function appHref(item: ApplicantAlertRow): string | null {
  return item.detailUrl || `${env.webAppUrl()}?tab=applicants&q=${encodeURIComponent(item.name || '')}`;
}

function talentHref(item: TalentAlertRow): string | null {
  return item.profileUrl || `${env.webAppUrl()}?tab=talent&q=${encodeURIComponent(item.name || '')}`;
}

function skillPills(skills: string[] | undefined): string {
  if (!skills?.length) return '<span style="color:#9ca3af">—</span>';
  return skills
    .slice(0, 5)
    .map(
      (s) =>
        `<span style="display:inline-block;background:#f3e8ff;color:#6b21a8;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:600;margin:1px 3px 1px 0">${esc(s)}</span>`,
    )
    .join('');
}

function applicantRows(items: ApplicantAlertRow[], showNew = false): string {
  if (!items.length) {
    return `<tr><td colspan="6" style="padding:16px 12px;color:#6b7280;text-align:center">해당 지원자 없음</td></tr>`;
  }
  return items
    .slice(0, 50)
    .map((item) => {
      const badge = showNew
        ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:800">NEW</span>`
        : '';
      return `<tr>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:13px">${esc(item.postingTitle || item.position || '공고 미연결')}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;white-space:nowrap">${esc(item.name || '(이름 없음)')}${badge}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:13px;white-space:nowrap">${fmtTime(item.appliedAt)}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:12px;color:#475569">${esc(item.careerTotal || '—')}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;text-align:center">${pdfCell(item.pdfUrl)}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;text-align:center">${detailBtn(appHref(item))}</td>
      </tr>`;
    })
    .join('');
}

function talentRows(items: TalentAlertRow[]): string {
  if (!items.length) {
    return `<tr><td colspan="7" style="padding:16px 12px;color:#6b7280;text-align:center">해당 인재 없음</td></tr>`;
  }
  return items
    .map((item) => {
      const role = clean((item.roles || [])[0] || item.headline || '—').slice(0, 40);
      const skills = (item.skills || []).map(clean).filter(Boolean);
      return `<tr>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;white-space:nowrap">${esc(clean(item.name) || '(이름 없음)')}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:12px">${esc(role)}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;font-size:12px;white-space:nowrap">${esc(clean(item.careerText) || '—')}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7">${skillPills(skills)}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;text-align:center">${detailBtn(item.profileUrl, '바로가기')}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;text-align:center">${pdfCell(item.pdfUrl)}</td>
        <td style="padding:11px 10px;border-bottom:1px solid #eef2f7;text-align:center">${detailBtn(talentHref(item))}</td>
      </tr>`;
    })
    .join('');
}

function sectionCard(params: {
  accent: string;
  iconBg: string;
  title: string;
  rangeLabel: string;
  count: number;
  thead: string;
  tbody: string;
}): string {
  return `<div style="margin:0 0 18px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:1px solid #eef2f7">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="width:10px;background:${params.accent};border-radius:4px">&nbsp;</td>
            <td style="padding-left:10px">
              <div style="font-size:15px;font-weight:800;color:#0f172a">${esc(params.title)}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">[${esc(params.rangeLabel)}]</div>
            </td>
          </tr></table>
        </td>
        <td align="right"><span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${params.iconBg};color:${params.accent};font-size:12px;font-weight:800">총 ${params.count}명</span></td>
      </tr></table>
    </div>
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#f8fafc;color:#64748b;font-size:11px;text-align:left">${params.thead}</tr></thead>
      <tbody>${params.tbody}</tbody>
    </table>
  </div>`;
}

function kpi(label: string, value: string, sub: string, color: string): string {
  return `<td style="width:33.33%;padding:4px">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 12px;text-align:center">
      <div style="font-size:12px;color:#64748b;font-weight:600">${esc(label)}</div>
      <div style="margin-top:6px;font-size:26px;font-weight:800;color:${color}">${esc(value)}</div>
      <div style="margin-top:6px;font-size:11px;color:#94a3b8">${esc(sub)}</div>
    </div>
  </td>`;
}

const APP_HEAD = `
  <th style="padding:9px 10px;font-weight:700">채용공고</th>
  <th style="padding:9px 10px;font-weight:700">이름</th>
  <th style="padding:9px 10px;font-weight:700">지원시각</th>
  <th style="padding:9px 10px;font-weight:700">경력</th>
  <th style="padding:9px 10px;font-weight:700;text-align:center">이력서</th>
  <th style="padding:9px 10px;font-weight:700;text-align:center">이동</th>`;

const TALENT_HEAD = `
  <th style="padding:9px 10px;font-weight:700">이름</th>
  <th style="padding:9px 10px;font-weight:700">직무</th>
  <th style="padding:9px 10px;font-weight:700">경력</th>
  <th style="padding:9px 10px;font-weight:700">핵심 역량</th>
  <th style="padding:9px 10px;font-weight:700;text-align:center">프로필</th>
  <th style="padding:9px 10px;font-weight:700;text-align:center">이력서</th>
  <th style="padding:9px 10px;font-weight:700;text-align:center">이동</th>`;

export function buildMorningDigestHtml(params: {
  slices: DigestReportSlices;
  evening: ApplicantAlertRow[];
  talents: TalentAlertRow[];
  workday: ApplicantAlertRow[];
}): string {
  const { slices, evening, talents, workday } = params;
  const totalApps = evening.length + workday.length;
  const review = evening.length + talents.length + workday.length;
  const reportDay = fmtReportDay(slices.reportDate);

  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Apple SD Gothic Neo,Malgun Gothic,Arial,sans-serif;color:#1f2937;line-height:1.5">
  <div style="max-width:860px;margin:0 auto;padding:20px 12px 28px">
    <div style="background:#0f2747;border-radius:16px 16px 0 0;padding:22px;color:#fff">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div style="font-size:20px;font-weight:800">${tw('1f4e8', '', 22)} 채용 모닝 다이제스트</div>
          <div style="margin-top:8px;font-size:13px;opacity:0.9">전일(${esc(reportDay)}) 채용 현황 요약</div>
        </td>
        <td align="right" style="font-size:13px;font-weight:600;white-space:nowrap">${esc(fmtHeaderDate(slices.sendDate))}</td>
      </tr></table>
    </div>

    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-top:0;padding:16px 14px 8px">
      <div style="font-size:13px;font-weight:800;color:#0f172a;margin:0 0 10px 4px">전일 채용 요약</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${kpi('신규 지원자', `${totalApps}명`, `근무 ${workday.length} · 저녁 ${evening.length}`, '#2563eb')}
        ${kpi('추천 인재', `${talents.length}명`, '인재풀 신규 검색', '#059669')}
        ${kpi('검토 항목', `${review}건`, '오늘 확인 권장', '#7c3aed')}
      </tr></table>
    </div>

    <div style="background:#f1f5f9;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;padding:16px 14px 18px">
      ${sectionCard({
        accent: '#2563eb',
        iconBg: '#dbeafe',
        title: `1. ${slices.evening.title}`,
        rangeLabel: slices.evening.rangeLabel,
        count: evening.length,
        thead: APP_HEAD,
        tbody: applicantRows(evening, true),
      })}
      ${sectionCard({
        accent: '#7c3aed',
        iconBg: '#ede9fe',
        title: '2. 어제 신규 추천 인재 (인재풀)',
        rangeLabel: '신규 검색',
        count: talents.length,
        thead: TALENT_HEAD,
        tbody: talentRows(talents),
      })}
      ${sectionCard({
        accent: '#059669',
        iconBg: '#d1fae5',
        title: `3. ${slices.workday.title}`,
        rangeLabel: slices.workday.rangeLabel,
        count: workday.length,
        thead: APP_HEAD,
        tbody: applicantRows(workday, false),
      })}
      <div style="margin-top:4px;padding:12px 14px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;font-size:12px;color:#1e40af;line-height:1.55">
        <b>TIP</b> · 실시간 알림을 받지 않아도 이 메일만으로 전일 지원·인재 현황을 확인할 수 있습니다. <b>자세히 보기</b>/<b>PDF 열기</b>로 바로 이동하세요.
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;text-align:center">TBELL Employ 자동 발송 · 알림 설정은 웹 프로필에서 변경할 수 있습니다.</p>
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
  const totalApps = eveningCount + workdayCount;
  return `[TBELL] 채용 모닝 다이제스트 · ${fmtHeaderDate(slices.sendDate)} · 지원 ${totalApps} · 인재 ${talentCount}`;
}
