/**
 * 지원자 알림 스케줄 (Asia/Seoul)
 *
 * - 월~금 07:30–19:00: 실시간 알림
 * - 화~금 07:30: 모닝 알림 (전일 19:00 ~ 당일 07:30)
 * - 월 07:30: 주말 알림 (금 19:00 ~ 월 07:30) — 모닝과 별도 발송 없음
 * - 토·일: 다이제스트 없음
 */

const TZ = 'Asia/Seoul';

export type KstParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0=일 … 6=토 */
  weekday: number;
  dateKey: string; // YYYY-MM-DD
};

export type DigestKind = 'weekend' | 'morning';

export type DigestWindow = {
  kind: DigestKind;
  start: Date;
  end: Date;
  label: string;
};

export function toKstParts(date: Date = new Date()): KstParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? 0,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** KST 벽시계 → UTC Date */
export function kstWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+09:00`,
  );
}

export function addCalendarDays(parts: KstParts, delta: number): KstParts {
  const noon = kstWallTimeToUtc(parts.year, parts.month, parts.day, 12, 0);
  return toKstParts(new Date(noon.getTime() + delta * 86_400_000));
}

export function isWeekendKst(parts: KstParts): boolean {
  return parts.weekday === 0 || parts.weekday === 6;
}

/** 월~금 07:30 이상 19:00 미만 */
export function isRealtimeNotifyWindow(now: Date = new Date()): boolean {
  const p = toKstParts(now);
  if (isWeekendKst(p)) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= 7 * 60 + 30 && mins < 19 * 60;
}

/** 다이제스트 실행 요일: 월~금만 (토·일 없음, 금 야간은 월요일 주말 알림) */
export function isDigestDay(now: Date = new Date()): boolean {
  const p = toKstParts(now);
  return p.weekday >= 1 && p.weekday <= 5;
}

/**
 * 당일 07:30 기준 다이제스트 구간.
 * - 월: 금 19:00 → 월 07:30 (주말 알림)
 * - 화~금: 전일 19:00 → 당일 07:30 (모닝 알림)
 */
export function getDigestWindow(now: Date = new Date()): DigestWindow | null {
  const p = toKstParts(now);
  if (p.weekday < 1 || p.weekday > 5) return null;

  const end = kstWallTimeToUtc(p.year, p.month, p.day, 7, 30);

  if (p.weekday === 1) {
    const fri = addCalendarDays(p, -3);
    const start = kstWallTimeToUtc(fri.year, fri.month, fri.day, 19, 0);
    return {
      kind: 'weekend',
      start,
      end,
      label: '주말 알림',
    };
  }

  const yesterday = addCalendarDays(p, -1);
  const start = kstWallTimeToUtc(
    yesterday.year,
    yesterday.month,
    yesterday.day,
    19,
    0,
  );
  return {
    kind: 'morning',
    start,
    end,
    label: '모닝 알림',
  };
}

export type DigestReportSlices = {
  kind: DigestKind;
  label: string;
  /** 메일 헤더용 발송일 (오늘) */
  sendDate: KstParts;
  /** 요약에 쓰는 전일(또는 금요일) */
  reportDate: KstParts;
  /** 저녁 신규: 전일 18:00 ~ 익일 00:00 (월요일이면 금 18:00 ~ 월 00:00 대신 금18~월07:30 보류분) */
  evening: { start: Date; end: Date; title: string; rangeLabel: string };
  /** 근무시간 전체: 전일 09:00 ~ 18:00 (월요일이면 금 09:00~18:00) */
  workday: { start: Date; end: Date; title: string; rangeLabel: string };
  /** 인재 수집 구간 (기존 digest window) */
  talent: { start: Date; end: Date };
};

/**
 * 모닝 메일 섹션용 시간대.
 * 1) 저녁 지원  2) 인재풀  3) 근무시간 지원(전체)
 */
export function getDigestReportSlices(now: Date = new Date()): DigestReportSlices | null {
  const win = getDigestWindow(now);
  if (!win) return null;
  const p = toKstParts(now);
  const reportDate = win.kind === 'weekend' ? addCalendarDays(p, -3) : addCalendarDays(p, -1);

  const workdayStart = kstWallTimeToUtc(reportDate.year, reportDate.month, reportDate.day, 9, 0);
  const workdayEnd = kstWallTimeToUtc(reportDate.year, reportDate.month, reportDate.day, 18, 0);
  const eveningStart = kstWallTimeToUtc(reportDate.year, reportDate.month, reportDate.day, 18, 0);
  const eveningEnd =
    win.kind === 'weekend'
      ? win.end
      : kstWallTimeToUtc(p.year, p.month, p.day, 0, 0);

  return {
    kind: win.kind,
    label: win.label,
    sendDate: p,
    reportDate,
    evening: {
      start: eveningStart,
      end: eveningEnd,
      title: win.kind === 'weekend' ? '주말·야간 신규 지원자' : '어제 저녁 신규 지원자',
      rangeLabel: win.kind === 'weekend' ? '금 18:00 ~ 월 07:30' : '18:00 ~ 24:00',
    },
    workday: {
      start: workdayStart,
      end: workdayEnd,
      title: win.kind === 'weekend' ? '금요일 근무시간 지원자' : '어제 근무시간 신규 지원자',
      rangeLabel: '09:00 ~ 18:00',
    },
    talent: { start: win.start, end: win.end },
  };
}

/**
 * 지원일(applied_at)이 주말이면 보류.
 * 지원일이 평일이어도, 지금이 실시간 창이 아니면 보류.
 */
export function shouldDeferApplicantAlert(
  appliedAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (appliedAt) {
    const applied = toKstParts(new Date(appliedAt));
    if (isWeekendKst(applied)) return true;
  }
  return !isRealtimeNotifyWindow(now);
}

export function splitRealtimeAndDeferred<
  T extends { appliedAt?: string | null },
>(items: T[], now: Date = new Date()): { realtime: T[]; deferred: T[] } {
  const realtime: T[] = [];
  const deferred: T[] = [];
  for (const item of items) {
    if (shouldDeferApplicantAlert(item.appliedAt, now)) deferred.push(item);
    else realtime.push(item);
  }
  return { realtime, deferred };
}
