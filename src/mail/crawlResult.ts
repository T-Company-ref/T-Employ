import type { RunResult } from '../crawler/runner.js';
import {
  loadApplicantAlertDetails,
  markApplicationsAlerted,
  type ApplicantAlertRow,
} from '../db/repositories/applicantAlerts.js';
import {
  markTalentsAlerted,
  type TalentAlertRow,
} from '../db/repositories/talentAlerts.js';
import { sendHtmlMail } from './transport.js';
import { resolveMailRecipients } from './recipients.js';
import {
  isRealtimeNotifyWindow,
  splitRealtimeAndDeferred,
  toKstParts,
  isWeekendKst,
  getDigestWindow,
  type DigestKind,
} from './notifySchedule.js';

/** Twemoji SVG (jsDelivr) — 메일 클라이언트용 <img> */
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg';

const EMOJI = {
  bell: '1f514',
  people: '1f465',
  person: '1f464',
  briefcase: '1f4bc',
  memo: '1f4dd',
  calendar: '1f4c5',
  page: '1f4c4',
  link: '1f517',
  warning: '26a0',
  check: '2705',
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tw(code: string, alt = '', size = 16): string {
  return `<img src="${TWEMOJI}/${code}.svg" width="${size}" height="${size}" alt="${esc(alt)}" style="vertical-align:-3px;border:0;outline:none;text-decoration:none;display:inline-block" />`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const p = toKstParts(d);
  return `${p.year}.${pad(p.month)}.${pad(p.day)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 예: 7월 18일 19:00 */
export function fmtKstDateTime(date: Date): string {
  const p = toKstParts(date);
  return `${p.month}월 ${p.day}일 ${pad(p.hour)}:${pad(p.minute)}`;
}

function rangeIntro(start: Date, end: Date, count: number): string {
  return `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6">
    ${tw(EMOJI.calendar, '기간', 18)}
    <b>${esc(fmtKstDateTime(start))}</b>부터
    <b>${esc(fmtKstDateTime(end))}</b>까지의 지원 이력입니다.
    <span style="color:#6b7280">(${count}명)</span>
  </p>`;
}

function metaLine(parts: Array<string | null | undefined>): string {
  const cleaned = parts.map((p) => (p || '').trim()).filter(Boolean);
  if (!cleaned.length) return '';
  return `<div style="color:#4b5563;font-size:13px;margin-top:4px">${cleaned.map(esc).join(' · ')}</div>`;
}

function tagHtml(tags: string[] | undefined): string {
  if (!tags?.length) return '';
  return `<div style="margin-top:6px">${tags
    .slice(0, 6)
    .map(
      (t) =>
        `<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:2px 8px;font-size:12px;margin:2px 4px 0 0">${esc(t)}</span>`,
    )
    .join('')}</div>`;
}

/** 프로필 링크(좌) + PDF 열기(우) */
function profilePdfActions(
  profileUrl: string | null | undefined,
  pdfUrl: string | null | undefined,
): string {
  const profile = profileUrl
    ? `<a href="${esc(profileUrl)}" style="color:#374151;font-weight:600;text-decoration:none">${tw(EMOJI.link, '프로필', 14)} 프로필</a>`
    : `<span style="color:#9ca3af">프로필 없음</span>`;
  const pdf = pdfUrl
    ? `<a href="${esc(pdfUrl)}" style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;background:#dbeafe;border:1px solid #93c5fd;color:#1d4ed8;font-size:13px;font-weight:700;text-decoration:none;line-height:1" title="이력서 PDF 열기">${tw(EMOJI.page, 'PDF', 14)} PDF 열기</a>`
    : `<span style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;color:#9ca3af;font-size:13px;font-weight:600;opacity:0.7" title="PDF 없음">${tw(EMOJI.page, '', 14)} PDF 없음</span>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px">
    <span>${profile}</span>
    <span>${pdf}</span>
  </div>`;
}

function applicantCards(items: ApplicantAlertRow[]): string {
  if (items.length === 0) {
    return `<tr><td style="padding:12px 10px;color:#6b7280">해당 지원자 없음</td></tr>`;
  }

  return (
    items
      .slice(0, 40)
      .map((item) => {
        const careerBits = (item.careerHistory || []).slice(0, 2).join(' / ');

        return `<tr>
        <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
          <div style="font-size:15px">
            ${tw(EMOJI.person, '', 18)}
            <b>${esc(item.name || '(이름 없음)')}</b>
            <span style="color:#9ca3af;font-size:12px;font-weight:400"> · ${esc(item.platformLabel || item.platform)}</span>
          </div>
          <div style="margin-top:8px;font-size:14px;color:#111827">
            ${tw(EMOJI.briefcase, '공고', 15)}
            ${esc(item.postingTitle || '공고 미연결')}
          </div>
          ${
            item.position
              ? `<div style="margin-top:5px;font-size:13px;color:#374151">${tw(EMOJI.memo, '분야', 14)} ${esc(item.position)}</div>`
              : ''
          }
          ${metaLine([item.genderAge, item.careerTotal ? `경력 ${item.careerTotal}` : null, item.education, item.desiredSalary])}
          ${careerBits ? `<div style="color:#6b7280;font-size:12px;margin-top:4px">${esc(careerBits)}</div>` : ''}
          ${tagHtml(item.recommendTags)}
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap;text-align:right">
          <div style="font-size:13px">${tw(EMOJI.calendar, '', 14)} ${fmtDate(item.appliedAt)}</div>
          ${profilePdfActions(item.detailUrl, item.pdfUrl)}
        </td>
      </tr>`;
      })
      .join('') +
    (items.length > 40
      ? `<tr><td colspan="2" style="padding:8px 10px;color:#6b7280">… 외 ${items.length - 40}명</td></tr>`
      : '')
  );
}

async function resolveMailItems(
  items: Array<{ applicationId: string } & Partial<ApplicantAlertRow>>,
): Promise<ApplicantAlertRow[]> {
  const ids = items.map((i) => i.applicationId).filter(Boolean);
  const detailed = await loadApplicantAlertDetails(ids);
  if (detailed.length > 0) return detailed;
  return items.map((i) => ({
    applicationId: i.applicationId,
    name: i.name ?? null,
    postingTitle: i.postingTitle ?? null,
    platform: i.platform ?? '',
    appliedAt: i.appliedAt ?? null,
    externalRef: i.externalRef ?? '',
  }));
}

function digestSubject(kind: DigestKind, count: number, start: Date, end: Date): string {
  const a = toKstParts(start);
  const b = toKstParts(end);
  const range = `${a.month}/${a.day} ${pad(a.hour)}:${pad(a.minute)}–${b.month}/${b.day} ${pad(b.hour)}:${pad(b.minute)}`;
  const tag = kind === 'weekend' ? '주말' : '모닝';
  return `[TBELL] ${tag} 지원 ${count}명 · ${range}`;
}

function realtimeSubject(count: number, now = new Date()): string {
  const p = toKstParts(now);
  return `[TBELL] 신규 지원 ${count}명 · ${p.month}/${p.day} ${pad(p.hour)}:${pad(p.minute)}`;
}

async function sendApplicantListMail(params: {
  subject: string;
  titleHtml: string;
  introHtml: string;
  items: Array<{ applicationId: string } & Partial<ApplicantAlertRow>>;
  markIds?: string[];
  channel?: 'realtime' | 'digest';
}): Promise<void> {
  const to = await resolveMailRecipients(params.channel ?? 'realtime');
  if (to.length === 0) {
    console.log('[mail/crawl] 수신자 없음 — 발송 생략');
    return;
  }
  const enriched = await resolveMailItems(params.items);
  const html = `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:16px;background:#f8fafc;font-family:Segoe UI,Apple SD Gothic Neo,Malgun Gothic,Arial,sans-serif;color:#1f2937;line-height:1.5">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 18px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${params.titleHtml}</h2>
    ${params.introHtml}
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;color:#64748b;font-size:12px;background:#f1f5f9">
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${tw(EMOJI.people, '', 14)} 지원자 · 공고</th>
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${tw(EMOJI.calendar, '', 14)} 지원일 · PDF</th>
      </tr></thead>
      <tbody>${applicantCards(enriched)}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">TBELL Employ</p>
  </div>
  </body></html>`;

  await sendHtmlMail({ to, subject: params.subject, html, allowDryRun: true });
  if (params.markIds?.length) {
    await markApplicationsAlerted(params.markIds);
  }
  console.log(`[mail/crawl] ${params.subject} → ${to.join(', ')} (${enriched.length}명)`);
}

/**
 * 크롤 직후 알림:
 * - 실시간 창(월~금 07:30–19:00): 평일 지원 신규만 즉시 발송
 * - 주말 지원·야간 발견분은 모닝 다이제스트로 보류
 */
export async function sendApplicantCrawlResultMail(results: RunResult[]): Promise<void> {
  const failed = results.filter((r) => r.error && !r.skipped);
  const inserted = results.reduce((n, r) => n + (r.inserted ?? 0), 0);
  const updated = results.reduce((n, r) => n + (r.updated ?? 0), 0);
  const resumes = results.reduce((n, r) => n + (r.resumesSaved ?? 0), 0);
  const newItems = results.flatMap((r) => r.newItems ?? []);
  const now = new Date();

  if (failed.length > 0) {
    const detail = failed
      .map((f) => `<li><b>${esc(f.platform)}</b>: ${esc(f.error || '')}</li>`)
      .join('');
    const opsTo = await resolveMailRecipients('ops');
    await sendHtmlMail({
      to: opsTo,
      subject: `[TBELL] 크롤 실패 · ${failed.map((f) => f.platform).join(', ')}`,
      html: `<!DOCTYPE html><html lang="ko"><body style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;padding:16px">
        <h2 style="color:#dc2626">${tw(EMOJI.warning, '', 20)} 지원자 크롤 실패</h2>
        <ul>${detail}</ul>
        <p style="color:#6b7280">신규 ${inserted} · 갱신 ${updated} · PDF ${resumes}</p>
      </body></html>`,
      allowDryRun: true,
    });
    console.log(`[mail/crawl] 실패 알림 → ${opsTo.join(', ')}`);
  }

  if (newItems.length === 0) {
    console.log('[mail/crawl] 신규 지원자 없음 — 지원 알림 생략');
    return;
  }

  const { realtime, deferred } = splitRealtimeAndDeferred(newItems, now);
  const kst = toKstParts(now);

  const weekendCatchUp = deferred.filter(
    (i) => i.appliedAt && isWeekendKst(toKstParts(new Date(i.appliedAt))),
  );

  if (kst.weekday === 1 && isRealtimeNotifyWindow(now) && weekendCatchUp.length > 0) {
    const win = getDigestWindow(now);
    const start = win?.start ?? now;
    await sendApplicantListMail({
      subject: digestSubject('weekend', weekendCatchUp.length, start, now),
      titleHtml: `${tw(EMOJI.bell, '', 20)} 주말 지원 ${weekendCatchUp.length}명`,
      introHtml: rangeIntro(start, now, weekendCatchUp.length),
      items: weekendCatchUp,
      markIds: weekendCatchUp.map((i) => i.applicationId),
      channel: 'digest',
    });
  }

  const weekendIds = new Set(weekendCatchUp.map((i) => i.applicationId));
  const realtimeOnly = realtime.filter((i) => !weekendIds.has(i.applicationId));

  if (realtimeOnly.length > 0 && isRealtimeNotifyWindow(now)) {
    await sendApplicantListMail({
      subject: realtimeSubject(realtimeOnly.length, now),
      titleHtml: `${tw(EMOJI.bell, '', 20)} 신규 지원 ${realtimeOnly.length}명`,
      introHtml: `<p style="margin:0 0 14px;font-size:14px;color:#374151">${tw(EMOJI.calendar, '', 18)} <b>${esc(fmtKstDateTime(now))}</b> 기준 신규 지원 이력입니다. <span style="color:#6b7280">(${realtimeOnly.length}명)</span></p>`,
      items: realtimeOnly,
      markIds: realtimeOnly.map((i) => i.applicationId),
      channel: 'realtime',
    });
  } else if (deferred.length > weekendCatchUp.length) {
    console.log(
      `[mail/crawl] 보류 ${deferred.length - weekendCatchUp.length}명 다이제스트 대기`,
    );
  }
}

/** 07:30 다이제스트 — 지원자 + 인재 한 통 */
export async function sendCombinedDigestMail(
  applicants: ApplicantAlertRow[],
  talents: TalentAlertRow[],
  options: {
    kind: DigestKind;
    label: string;
    start: Date;
    end: Date;
  },
): Promise<void> {
  if (applicants.length === 0 && talents.length === 0) {
    console.log(`[mail/crawl] ${options.label} — 발송할 지원자·인재 없음`);
    return;
  }

  const a = toKstParts(options.start);
  const b = toKstParts(options.end);
  const range = `${a.month}/${a.day} ${pad(a.hour)}:${pad(a.minute)}–${b.month}/${b.day} ${pad(b.hour)}:${pad(b.minute)}`;
  const tag = options.kind === 'weekend' ? '주말' : '모닝';
  const subject = `[TBELL] ${tag} 지원 ${applicants.length}명 · 인재 ${talents.length}명 · ${range}`;

  const title =
    options.kind === 'weekend'
      ? `${tw(EMOJI.bell, '', 20)} 주말 다이제스트`
      : `${tw(EMOJI.bell, '', 20)} 모닝 다이제스트`;

  const intro = `<p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6">
    ${tw(EMOJI.calendar, '기간', 18)}
    <b>${esc(fmtKstDateTime(options.start))}</b> ~
    <b>${esc(fmtKstDateTime(options.end))}</b>
    사이 지원자 ${applicants.length}명 · 추천 인재 ${talents.length}명
  </p>`;

  const to = await resolveMailRecipients('digest');
  if (to.length === 0) {
    console.log('[mail/crawl] 다이제스트 수신자 없음 — 발송 생략');
    return;
  }
  const enrichedApplicants = await resolveMailItems(applicants);

  const html = `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:16px;background:#f8fafc;font-family:Segoe UI,Apple SD Gothic Neo,Malgun Gothic,Arial,sans-serif;color:#1f2937;line-height:1.5">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 18px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${title}</h2>
    ${intro}

    <h3 style="margin:24px 0 10px;font-size:15px;color:#0f172a">${tw(EMOJI.people, '', 18)} 지원자 ${applicants.length}명</h3>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;color:#64748b;font-size:12px;background:#f1f5f9">
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${tw(EMOJI.people, '', 14)} 지원자 · 공고</th>
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${tw(EMOJI.calendar, '', 14)} 지원일 · PDF</th>
      </tr></thead>
      <tbody>${applicantCards(enrichedApplicants)}</tbody>
    </table>

    <h3 style="margin:28px 0 10px;font-size:15px;color:#0f172a">${tw(EMOJI.people, '', 18)} 추천 인재 ${talents.length}명</h3>
    <p style="margin:0 0 10px;font-size:12px;color:#6b7280">구직·이직 가능 확인 · 최대 5명</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;color:#64748b;font-size:12px;background:#f1f5f9">
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${tw(EMOJI.people, '', 14)} 후보</th>
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${tw(EMOJI.calendar, '', 14)} 수집일 · PDF</th>
      </tr></thead>
      <tbody>${talentCards(talents)}</tbody>
    </table>

    <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">TBELL Employ</p>
  </div>
  </body></html>`;

  await sendHtmlMail({ to, subject, html, allowDryRun: true });
  if (applicants.length > 0) {
    await markApplicationsAlerted(applicants.map((i) => i.applicationId));
  }
  if (talents.length > 0) {
    await markTalentsAlerted(talents.map((i) => i.talentId));
  }
  console.log(
    `[mail/crawl] ${subject} → ${to.join(', ')} (지원 ${enrichedApplicants.length} · 인재 ${talents.length})`,
  );
}

/** 07:30 다이제스트 — 월요일=주말, 화~금=모닝 */
export async function sendDigestApplicantMail(
  items: ApplicantAlertRow[],
  options: {
    kind: DigestKind;
    label: string;
    start: Date;
    end: Date;
  },
): Promise<void> {
  if (items.length === 0) {
    console.log(`[mail/crawl] ${options.label} — 발송할 지원자 없음`);
    return;
  }

  const title =
    options.kind === 'weekend'
      ? `${tw(EMOJI.bell, '', 20)} 주말 지원 ${items.length}명`
      : `${tw(EMOJI.bell, '', 20)} 모닝 지원 ${items.length}명`;

  await sendApplicantListMail({
    subject: digestSubject(options.kind, items.length, options.start, options.end),
    titleHtml: title,
    introHtml: rangeIntro(options.start, options.end, items.length),
    items,
    markIds: items.map((i) => i.applicationId),
  });
}

function cleanDisplayText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b화살표\b/g, '')
    .replace(/[▶►▸▹➔➜➝➞➡⇒⟶→←↑↓]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function talentCards(items: TalentAlertRow[]): string {
  if (items.length === 0) {
    return `<tr><td style="padding:12px 10px;color:#6b7280">해당 인재 없음</td></tr>`;
  }
  return items
    .map((item) => {
      const roles = (item.roles || []).slice(0, 3).map(cleanDisplayText).filter(Boolean).join(' · ');
      const skills = (item.skills || []).slice(0, 6).map(cleanDisplayText).filter(Boolean).join(', ');
      const headline = cleanDisplayText(item.headline).slice(0, 120);
      const company = cleanDisplayText(item.company);
      const companyOk = company && company !== '경력사항' ? company : null;

      return `<tr>
        <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
          <div style="font-size:15px">
            ${tw(EMOJI.person, '', 18)}
            <b>${esc(cleanDisplayText(item.name) || '(이름 없음)')}</b>
            ${item.jobStatus ? `<span style="color:#059669;font-size:12px"> · ${esc(cleanDisplayText(item.jobStatus))}</span>` : ''}
          </div>
          ${headline ? `<div style="margin-top:6px;font-size:13px;color:#111827">${esc(headline)}</div>` : ''}
          ${metaLine([item.genderAge, item.careerText, companyOk])}
          ${roles ? `<div style="margin-top:4px;font-size:12px;color:#6b7280">${esc(roles)}</div>` : ''}
          ${skills ? `<div style="margin-top:4px;font-size:12px;color:#64748b">${esc(skills)}</div>` : ''}
          ${tagHtml(item.badges)}
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap;text-align:right">
          <div style="font-size:13px">${tw(EMOJI.calendar, '', 14)} ${fmtDate(item.sourcedAt)}</div>
          ${profilePdfActions(item.profileUrl, item.pdfUrl)}
        </td>
      </tr>`;
    })
    .join('');
}

/** 07:30 인재검색 알림 (최대 5명, 구직/이직 가능 확인분) */
export async function sendDigestTalentMail(
  items: TalentAlertRow[],
  options: { start: Date; end: Date },
): Promise<void> {
  if (items.length === 0) {
    console.log('[mail/crawl] 인재 알림 — 발송할 인재 없음');
    return;
  }

  const a = toKstParts(options.start);
  const b = toKstParts(options.end);
  const range = `${a.month}/${a.day} ${pad(a.hour)}:${pad(a.minute)}–${b.month}/${b.day} ${pad(b.hour)}:${pad(b.minute)}`;
  const to = await resolveMailRecipients('digest');
  if (to.length === 0) {
    console.log('[mail/crawl] 인재 알림 수신자 없음 — 발송 생략');
    return;
  }

  const html = `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:16px;background:#f8fafc;font-family:Segoe UI,Apple SD Gothic Neo,Malgun Gothic,Arial,sans-serif;color:#1f2937;line-height:1.5">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 18px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${tw(EMOJI.people, '', 20)} 인재검색 ${items.length}명</h2>
    <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6">
      ${tw(EMOJI.calendar, '기간', 18)}
      <b>${esc(fmtKstDateTime(options.start))}</b> ~
      <b>${esc(fmtKstDateTime(options.end))}</b>
      사이 새로 수집한 후보입니다. (구직·이직 가능 확인 · 최대 5명)
    </p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;color:#64748b;font-size:12px;background:#f1f5f9">
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${tw(EMOJI.people, '', 14)} 후보</th>
        <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${tw(EMOJI.calendar, '', 14)} 수집일 · PDF</th>
      </tr></thead>
      <tbody>${talentCards(items)}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">TBELL Employ</p>
  </div>
  </body></html>`;

  await sendHtmlMail({
    to,
    subject: `[TBELL] 인재검색 ${items.length}명 · ${range}`,
    html,
    allowDryRun: true,
  });
  await markTalentsAlerted(items.map((i) => i.talentId));
  console.log(`[mail/crawl] 인재 ${items.length}명 → ${to.join(', ')}`);
}
