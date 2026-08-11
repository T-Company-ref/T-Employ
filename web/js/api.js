/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

/** Supabase/PostgREST 기본 max-rows 를 넘는 목록을 range 로 전량 수집 */
async function fetchAllRows(buildQuery, { pageSize = 1000, max = 10_000 } = {}) {
  const all = [];
  for (let from = 0; from < max; from += pageSize) {
    const to = Math.min(from + pageSize - 1, max - 1);
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

export async function getSession(sb) {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(sb, email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** 운영 웹 URL — 로컬/미리보기에서도 재설정 랜딩은 GitHub Pages 고정 */
export function appRedirectUrl() {
  return "https://t-company-ref.github.io/T-Employ/";
}

/** 비밀번호 재설정 메일 (Auth 계정 있을 때만 실제 발송). 존재 여부는 호출부에서 노출하지 말 것. */
export async function requestPasswordRecovery(sb, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) throw new Error("이메일을 확인하세요");
  const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: appRedirectUrl() });
  if (error) throw error;
  return true;
}

/** 복구 세션에서 새 비밀번호 저장 */
export async function updatePassword(sb, password) {
  const pw = String(password || "");
  if (pw.length < 6) throw new Error("비밀번호는 6자 이상이어야 합니다");
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) throw error;
  return true;
}

/** 메일 링크의 token_hash 로 recovery 세션 확정 (Site URL 우회) */
export async function verifyRecoveryToken(sb, tokenHash) {
  const th = String(tokenHash || "").trim();
  if (!th) throw new Error("복구 토큰이 없습니다");
  const { data, error } = await sb.auth.verifyOtp({
    type: "recovery",
    token_hash: th,
  });
  if (error) throw error;
  return data;
}

export async function signOut(sb) {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getMyStaff(sb) {
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) throw userErr;
  const user = userData.user;
  if (!user) return null;

  const { data, error } = await sb
    .from("staff_profiles")
    .select(
      "id, nickname, display_name, email, role, is_active, auth_user_id, notify_pref, notify_realtime, notify_digest",
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  if (data) return data;

  // 트리거 미실행(기존 계정) 시 이메일로 1회 연결 시도는 service_role 필요.
  // 웹에서는 안내만.
  return {
    id: null,
    nickname: user.email?.split("@")[0] ?? "user",
    display_name: user.email,
    email: user.email,
    role: "viewer",
    notify_pref: "none",
    notify_realtime: false,
    notify_digest: false,
    is_active: true,
    auth_user_id: user.id,
    _unlinked: true,
  };
}

function legacyNotifyPref(realtime, digest) {
  if (realtime) return "realtime";
  if (digest) return "digest";
  return "none";
}

/** 본인 프로필: 별명·표시명·알림 설정 (역할 변경 불가) */
export async function updateMyStaffProfile(
  sb,
  staffId,
  { nickname, displayName, notifyRealtime, notifyDigest },
) {
  const patch = {};
  if (nickname != null) patch.nickname = String(nickname).trim();
  if (displayName != null) patch.display_name = String(displayName).trim();
  if (notifyRealtime != null) patch.notify_realtime = Boolean(notifyRealtime);
  if (notifyDigest != null) patch.notify_digest = Boolean(notifyDigest);
  if (notifyRealtime != null && notifyDigest != null) {
    patch.notify_pref = legacyNotifyPref(Boolean(notifyRealtime), Boolean(notifyDigest));
  }
  const { data, error } = await sb
    .from("staff_profiles")
    .update(patch)
    .eq("id", staffId)
    .select(
      "id, nickname, display_name, email, role, is_active, auth_user_id, notify_pref, notify_realtime, notify_digest",
    )
    .single();
  if (error) throw error;
  return data;
}

export async function listMyPostingNotify(sb, staffId) {
  const { data, error } = await sb
    .from("staff_posting_notify")
    .select("posting_id")
    .eq("staff_id", staffId);
  if (error) throw error;
  return (data ?? []).map((r) => r.posting_id);
}

/** 관심 공고 전체 교체 (진행중 공고만 전달) */
export async function setMyPostingNotify(sb, staffId, postingIds) {
  const ids = [...new Set((postingIds || []).filter(Boolean))];
  const { error: delErr } = await sb.from("staff_posting_notify").delete().eq("staff_id", staffId);
  if (delErr) throw delErr;
  if (!ids.length) return [];
  const rows = ids.map((posting_id) => ({ staff_id: staffId, posting_id }));
  const { data, error } = await sb.from("staff_posting_notify").insert(rows).select("posting_id");
  if (error) throw error;
  return (data ?? []).map((r) => r.posting_id);
}

export async function listPostings(sb, { q = "", platform = "", limit = 500 } = {}) {
  let query = sb
    .from("job_postings")
    .select("id, platform, title, external_posting_id, source_url, meta, category, opened_at, closed_at, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  let counts = {};
  if (ids.length) {
    const apps = await fetchAllRows(
      () => sb.from("applications").select("posting_id").in("posting_id", ids),
      { pageSize: 1000, max: 20_000 },
    );
    for (const a of apps) {
      if (!a.posting_id) continue;
      counts[a.posting_id] = (counts[a.posting_id] || 0) + 1;
    }
  }

  const needle = q.trim().toLowerCase();
  const postingEndMs = (row) => {
    const end = row.meta?.periodEnd;
    if (end) {
      const t = new Date(`${end}T12:00:00+09:00`).getTime();
      if (!Number.isNaN(t)) return t;
    }
    const period = String(row.meta?.period || "");
    const matches = [...period.matchAll(/(\d{4})\.(\d{2})\.(\d{2})/g)];
    const last = matches[matches.length - 1];
    if (!last) return 0;
    const t = new Date(`${last[1]}-${last[2]}-${last[3]}T12:00:00+09:00`).getTime();
    return Number.isNaN(t) ? 0 : t;
  };

  return rows
    .map((r) => ({ ...r, applicant_count: counts[r.id] || 0 }))
    .filter((row) => {
      if (!needle) return true;
      const hay = [row.title, row.external_posting_id, row.platform, row.meta?.manager, row.meta?.postingNumber]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => postingEndMs(b) - postingEndMs(a) || String(b.updated_at).localeCompare(String(a.updated_at)));
}

function kstDateKey(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function addDaysToKey(dateKey, delta) {
  const [y, m, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

export function kstTodayKey() {
  return kstDateKey(new Date());
}

/** inclusive day count between YYYY-MM-DD keys */
export function daysBetweenKeys(fromKey, toKey) {
  if (!fromKey || !toKey) return 0;
  const a = Date.parse(`${fromKey}T12:00:00+09:00`);
  const b = Date.parse(`${toKey}T12:00:00+09:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor(Math.abs(b - a) / 86_400_000) + 1;
}

export function monthBounds(year, monthIndex) {
  const from = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const next =
    monthIndex === 11
      ? `${year + 1}-01-01`
      : `${year}-${String(monthIndex + 2).padStart(2, "0")}-01`;
  const to = addDaysToKey(next, -1);
  return { from, to };
}

export function yearBounds(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function defaultDashRange() {
  const to = kstTodayKey();
  return { from: addDaysToKey(to, -13), to };
}

function kstDayStartIso(dateKey) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function kstDayEndIso(dateKey) {
  return new Date(`${dateKey}T23:59:59.999+09:00`).toISOString();
}

function formatDayLabel(dateKey, { withYear = false } = {}) {
  const [y, m, d] = dateKey.split("-");
  if (withYear) return `${y.slice(2)}.${Number(m)}.${Number(d)}`;
  return `${Number(m)}/${Number(d)}`;
}

/** fromKey~toKey(포함) 매일 버킷 — KST 날짜 기준 */
export function buildDailySeriesForRange(rows, dateField, fromKey, toKey) {
  const counts = {};
  for (const row of rows || []) {
    const k = kstDateKey(row[dateField]);
    if (!k || k < fromKey || k > toKey) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  const span = daysBetweenKeys(fromKey, toKey);
  const withYear = span > 90 || fromKey.slice(0, 4) !== toKey.slice(0, 4);
  const labels = [];
  const values = [];
  for (let k = fromKey; k <= toKey; k = addDaysToKey(k, 1)) {
    labels.push(formatDayLabel(k, { withYear }));
    values.push(counts[k] || 0);
  }
  return { labels, values, fromKey, toKey };
}

/** 대시보드 클라이언트 필터용 — applications 행(applied_at)으로 일별 시리즈 생성 */
export function buildAppsDailySeries(rows, days = 14) {
  const to = kstTodayKey();
  const from = addDaysToKey(to, -(days - 1));
  return buildDailySeriesForRange(rows || [], "applied_at", from, to);
}

/** 해당 KST 날짜의 월요일(주차 시작) */
function weekStartKey(dateKey) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(new Date(`${dateKey}T12:00:00+09:00`));
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = map[parts] ?? 1;
  const back = weekday === 0 ? 6 : weekday - 1;
  return addDaysToKey(dateKey, -back);
}

function countByDateKeys(rows, field, predicate) {
  let n = 0;
  for (const row of rows) {
    const key = kstDateKey(row[field]);
    if (key && predicate(key)) n += 1;
  }
  return n;
}

export async function getDashboardStats(sb, { fromKey, toKey } = {}) {
  const todayKey = kstTodayKey();
  const defaults = defaultDashRange();
  let rangeFrom = fromKey || defaults.from;
  let rangeTo = toKey || defaults.to;
  if (rangeFrom > rangeTo) [rangeFrom, rangeTo] = [rangeTo, rangeFrom];
  // 과도한 구간 방지 (약 2년)
  if (daysBetweenKeys(rangeFrom, rangeTo) > 731) {
    rangeFrom = addDaysToKey(rangeTo, -730);
  }

  const kpiSinceKey = addDaysToKey(todayKey, -30);
  const kpiSinceIso = kstDayStartIso(kpiSinceKey);
  const chartSinceIso = kstDayStartIso(rangeFrom);
  const chartUntilIso = kstDayEndIso(rangeTo);
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const weekFrom = weekStartKey(todayKey);

  const [apps, talents, postings, docs, recentApps, kpiAppDates, kpiTalentDates, appRows, talentRows] =
    await Promise.all([
      sb.from("applications").select("id", { count: "exact", head: true }),
      sb.from("talent_pool_candidates").select("id", { count: "exact", head: true }),
      sb.from("job_postings").select("id", { count: "exact", head: true }),
      sb.from("candidate_documents").select("id", { count: "exact", head: true }),
      sb
        .from("applications")
        .select(
          `id, applied_at, created_at, alerted_at, current_stage, platform,
           candidate:candidates ( name ),
           posting:job_postings ( title )`,
        )
        .order("created_at", { ascending: false })
        .limit(10),
      sb
        .from("applications")
        .select("applied_at")
        .gte("applied_at", kpiSinceIso)
        .order("applied_at", { ascending: true })
        .limit(5000),
      sb
        .from("talent_pool_candidates")
        .select("created_at")
        .gte("created_at", kpiSinceIso)
        .order("created_at", { ascending: true })
        .limit(5000),
      fetchAllRows(
        () =>
          sb
            .from("applications")
            .select("applied_at, posting_id, posting:job_postings ( id, title )")
            .gte("applied_at", chartSinceIso)
            .lte("applied_at", chartUntilIso)
            .order("applied_at", { ascending: true }),
        { pageSize: 1000, max: 20_000 },
      ),
      fetchAllRows(
        () =>
          sb
            .from("talent_pool_candidates")
            .select("created_at")
            .gte("created_at", chartSinceIso)
            .lte("created_at", chartUntilIso)
            .order("created_at", { ascending: true }),
        { pageSize: 1000, max: 20_000 },
      ),
    ]);

  for (const r of [apps, talents, postings, docs, recentApps, kpiAppDates, kpiTalentDates]) {
    if (r.error) throw r.error;
  }

  const kpiRows = kpiAppDates.data ?? [];
  const applicantsYesterday = countByDateKeys(kpiRows, "applied_at", (k) => k === yesterdayKey);
  const applicantsThisWeek = countByDateKeys(
    kpiRows,
    "applied_at",
    (k) => k >= weekFrom && k <= todayKey,
  );
  const kpiTalentRows = kpiTalentDates.data ?? [];
  const talentsYesterday = countByDateKeys(
    kpiTalentRows,
    "created_at",
    (k) => k === yesterdayKey,
  );
  const talentsToday = countByDateKeys(kpiTalentRows, "created_at", (k) => k === todayKey);

  /** @type {Map<string, string>} */
  const postingMap = new Map();
  for (const row of appRows) {
    const id = row.posting_id || row.posting?.id;
    if (!id) continue;
    const title = row.posting?.title || "공고 미연결";
    if (!postingMap.has(id)) postingMap.set(id, title);
  }
  const postingOptions = [...postingMap.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));

  const appDateRows = appRows.map((r) => ({
    applied_at: r.applied_at,
    posting_id: r.posting_id || r.posting?.id || null,
  }));
  const talentDateRows = talentRows.map((r) => ({ created_at: r.created_at }));

  return {
    applicants: apps.count ?? 0,
    talents: talents.count ?? 0,
    postings: postings.count ?? 0,
    documents: docs.count ?? 0,
    applicantsYesterday,
    applicantsThisWeek,
    talentsYesterday,
    talentsToday,
    yesterdayLabel: yesterdayKey.slice(5).replace("-", "."),
    weekLabel: `${weekFrom.slice(5).replace("-", ".")}–${todayKey.slice(5).replace("-", ".")}`,
    recentApps: recentApps.data ?? [],
    rangeFrom,
    rangeTo,
    appsDaily: buildDailySeriesForRange(appDateRows, "applied_at", rangeFrom, rangeTo),
    talentsDaily: buildDailySeriesForRange(talentDateRows, "created_at", rangeFrom, rangeTo),
    appDateRows,
    talentDateRows,
    postingOptions,
  };
}

export async function listApplications(
  sb,
  { q = "", platform = "", postingId = "", limit } = {},
) {
  // 전체 목록은 기본 상한을 크게 — 호출부 limit:500 이 다시 잘리지 않게
  const maxRows = postingId
    ? Math.max(Number(limit) || 0, 2_000)
    : Math.max(Number(limit) || 0, 10_000);
  const select = `
      id, platform, applied_at, created_at, current_stage, is_active, external_ref, profile_meta, posting_id,
      candidate:candidates!inner ( id, name, email, phone, is_active, source_type ),
      posting:job_postings ( id, title, external_posting_id, source_url, meta, closed_at )
    `;

  const data = await fetchAllRows(
    () => {
      let query = sb
        .from("applications")
        .select(select)
        .order("created_at", { ascending: false });
      if (platform) query = query.eq("platform", platform);
      if (postingId) query = query.eq("posting_id", postingId);
      return query;
    },
    { pageSize: 1000, max: maxRows },
  );

  const needle = q.trim().toLowerCase();
  if (!needle) return data;
  return data.filter((row) => {
    const meta = row.profile_meta || {};
    const hay = [
      row.candidate?.name,
      row.candidate?.email,
      row.candidate?.phone,
      row.platform,
      row.current_stage,
      meta.position,
      meta.careerTotal,
      meta.educationSchool,
      meta.educationMajor,
      meta.educationLevel,
      meta.education,
      row.posting?.title,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

/** application_id → { resume, attach } 빠른 필터용 */
export async function listApplicationDocFlags(sb) {
  const { data, error } = await sb
    .from("candidate_documents")
    .select("application_id, doc_type")
    .not("application_id", "is", null)
    .limit(50_000);
  if (error) throw error;
  /** @type {Map<string, { resume: boolean, attach: boolean }>} */
  const map = new Map();
  for (const row of data || []) {
    const id = row.application_id;
    if (!id) continue;
    let cur = map.get(id);
    if (!cur) {
      cur = { resume: false, attach: false };
      map.set(id, cur);
    }
    if (row.doc_type === "resume") cur.resume = true;
    else if (row.doc_type === "portfolio" || row.doc_type === "other") cur.attach = true;
  }
  return map;
}

export async function listTalents(sb, { q = "", platform = "", limit = 500 } = {}) {
  let query = sb
    .from("talent_pool_candidates")
    .select(
      `
      id, platform, profile_url, profile_ref, headline, summary_text, profile_meta,
      search_condition, proposal_status, is_active, sourced_at, created_at, category,
      primary_source_type, primary_requirement_id, primary_posting_id, primary_source_label,
      candidate:candidates ( id, name, email, phone, is_active )
    `,
    )
    .eq("is_active", true)
    .order("sourced_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) {
    // primary_* 컬럼 미적용 환경 폴백
    if (/primary_source|column/i.test(error.message || "")) {
      const fallback = await sb
        .from("talent_pool_candidates")
        .select(
          `
          id, platform, profile_url, profile_ref, headline, summary_text, profile_meta,
          search_condition, proposal_status, is_active, sourced_at, created_at, category,
          candidate:candidates ( id, name, email, phone, is_active )
        `,
        )
        .eq("is_active", true)
        .order("sourced_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (platform) {
        /* platform filter already applied above when possible */
      }
      if (fallback.error) throw fallback.error;
      return filterTalentRows(fallback.data ?? [], q);
    }
    throw error;
  }

  return filterTalentRows(data ?? [], q);
}

function filterTalentRows(rows, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    const hay = [
      row.candidate?.name,
      row.headline,
      row.summary_text,
      row.platform,
      row.proposal_status,
      row.search_condition,
      row.primary_source_label,
      row.primary_source_type,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

export async function listTalentDiscoveries(sb, talentPoolId) {
  const { data, error } = await sb
    .from("talent_discovery_sources")
    .select(
      `id, source_type, requirement_id, posting_id, source_label, platform, discovered_at,
       requirement:talent_search_requirements(id, title, keywords),
       posting:job_postings(id, title, platform)`,
    )
    .eq("talent_pool_id", talentPoolId)
    .order("discovered_at", { ascending: false });
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message || "")) return [];
    throw error;
  }
  return data ?? [];
}

export async function listTags(sb, targetType, targetId) {
  const { data, error } = await sb
    .from("candidate_tags")
    .select("id, tag_type, comment, tagged_at, is_active, tagged_by")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("is_active", true)
    .order("tagged_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.tagged_by).filter(Boolean))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, staff: null }));

  const { data: staffRows, error: staffErr } = await sb
    .from("staff_profiles")
    .select("id, nickname, display_name")
    .in("id", ids);
  if (staffErr) throw staffErr;
  const map = Object.fromEntries((staffRows ?? []).map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, staff: map[r.tagged_by] ?? null }));
}

export async function addTag(sb, { targetType, targetId, tagType, comment, staffId }) {
  const { data, error } = await sb
    .from("candidate_tags")
    .upsert(
      {
        target_type: targetType,
        target_id: targetId,
        tag_type: tagType,
        comment: comment || null,
        tagged_by: staffId,
        is_active: true,
        tagged_at: new Date().toISOString(),
      },
      { onConflict: "target_type,target_id,tag_type,tagged_by" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeTag(sb, tagId) {
  const { error } = await sb
    .from("candidate_tags")
    .update({ is_active: false })
    .eq("id", tagId);
  if (error) throw error;
}

export async function listInterviews(sb, candidateId) {
  const { data, error } = await sb
    .from("interview_events")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("interview_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function scheduleInterview(sb, payload) {
  const { data, error } = await sb
    .from("interview_events")
    .insert({
      candidate_id: payload.candidateId,
      application_id: payload.applicationId ?? null,
      interview_at: payload.interviewAt,
      interviewer: payload.interviewer || null,
      meeting_type: payload.meetingType || "onsite",
      result: "scheduled",
      note: payload.note || null,
      created_by: payload.staffId,
    })
    .select()
    .single();
  if (error) throw error;

  await recordStatus(sb, {
    candidateId: payload.candidateId,
    applicationId: payload.applicationId,
    statusCode: "interview_scheduled",
    reason: payload.note,
    staffId: payload.staffId,
  });

  if (payload.applicationId) {
    await sb
      .from("applications")
      .update({ current_stage: "interviewing" })
      .eq("id", payload.applicationId);
  }

  return data;
}

export async function updateInterviewResult(sb, payload) {
  const patch = {
    result: payload.result,
    note: payload.note ?? null,
  };
  if (payload.hiredStartDate) patch.hired_start_date = payload.hiredStartDate;

  const { data, error } = await sb
    .from("interview_events")
    .update(patch)
    .eq("id", payload.interviewId)
    .select()
    .single();
  if (error) throw error;

  const statusMap = {
    pass: payload.hiredStartDate ? "hired" : "interview_pass",
    fail: "interview_fail",
    no_show: "interview_no_show",
    canceled: "interviewing",
  };
  const statusCode = statusMap[payload.result];
  if (statusCode) {
    await recordStatus(sb, {
      candidateId: data.candidate_id,
      applicationId: data.application_id,
      statusCode,
      reason: payload.note,
      staffId: payload.staffId,
    });
    if (data.application_id) {
      const stageMap = {
        hired: "hired",
        interview_fail: "interview_rejected",
        interview_pass: "interviewing",
        interview_no_show: "interviewing",
        interviewing: "interviewing",
      };
      const stage = stageMap[statusCode];
      if (stage) {
        await sb.from("applications").update({ current_stage: stage }).eq("id", data.application_id);
      }
    }
  }
  return data;
}

export async function listStatusHistory(sb, candidateId) {
  const { data, error } = await sb
    .from("candidate_status_history")
    .select("id, status_code, reason, changed_at, changed_by")
    .eq("candidate_id", candidateId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, staff: null }));
  const { data: staffRows, error: staffErr } = await sb
    .from("staff_profiles")
    .select("id, nickname, display_name")
    .in("id", ids);
  if (staffErr) throw staffErr;
  const map = Object.fromEntries((staffRows ?? []).map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, staff: map[r.changed_by] ?? null }));
}

export async function recordStatus(sb, { candidateId, applicationId, statusCode, reason, staffId }) {
  const { error } = await sb.from("candidate_status_history").insert({
    candidate_id: candidateId,
    application_id: applicationId ?? null,
    status_code: statusCode,
    reason: reason || null,
    changed_by: staffId,
  });
  if (error) throw error;
}

export async function blockCandidate(sb, { candidateId, applicationId, reason, staffId }) {
  await recordStatus(sb, {
    candidateId,
    applicationId,
    statusCode: "blocked",
    reason,
    staffId,
  });
  await sb.from("candidates").update({ is_active: false }).eq("id", candidateId);
  if (applicationId) {
    await sb
      .from("applications")
      .update({ is_active: false, current_stage: "blocked" })
      .eq("id", applicationId);
  }
}

export async function blockTalent(sb, { talentId, candidateId, reason, staffId }) {
  await sb
    .from("talent_pool_candidates")
    .update({ is_active: false, proposal_status: "blocked" })
    .eq("id", talentId);
  if (candidateId) {
    await recordStatus(sb, {
      candidateId,
      statusCode: "blocked",
      reason: reason || "talent_pool blocked",
      staffId,
    });
    await sb.from("candidates").update({ is_active: false }).eq("id", candidateId);
  }
}

export async function setApplicationStage(sb, { applicationId, candidateId, stage, reason, staffId }) {
  const statusCode =
    stage === "blocked"
      ? "blocked"
      : stage === "hired"
        ? "hired"
        : stage === "interview_rejected"
          ? "rejected"
          : stage === "offer"
            ? "offer"
            : stage === "screening_pass"
              ? "screening_pass"
              : stage === "interviewing"
                ? "interviewing"
                : "applied";

  await recordStatus(sb, {
    candidateId,
    applicationId,
    statusCode,
    reason,
    staffId,
  });

  const patch = { current_stage: stage };
  if (stage === "blocked") patch.is_active = false;
  await sb.from("applications").update(patch).eq("id", applicationId);
  if (stage === "blocked") {
    await sb.from("candidates").update({ is_active: false }).eq("id", candidateId);
  }
}

export async function listDocuments(sb, { candidateId, applicationId, talentPoolId } = {}) {
  // application / talent 필터 + candidate 폴백을 합쳐서 보여준다
  const rows = [];
  const seen = new Set();

  const pushAll = (list) => {
    for (const d of list ?? []) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      rows.push(d);
    }
  };

  const selectFull =
    "id, doc_type, file_url, file_hash, collected_at, application_id, talent_pool_id, candidate_id, source_name, source_label";
  const selectBasic =
    "id, doc_type, file_url, file_hash, collected_at, application_id, talent_pool_id, candidate_id";

  async function selectEq(column, value) {
    let res = await sb
      .from("candidate_documents")
      .select(selectFull)
      .eq(column, value)
      .order("collected_at", { ascending: false });
    if (res.error && /source_name|source_label|column/i.test(res.error.message || "")) {
      res = await sb
        .from("candidate_documents")
        .select(selectBasic)
        .eq(column, value)
        .order("collected_at", { ascending: false });
    }
    if (res.error) throw res.error;
    pushAll(res.data);
  }

  if (applicationId) await selectEq("application_id", applicationId);
  if (talentPoolId) await selectEq("talent_pool_id", talentPoolId);
  if (candidateId) await selectEq("candidate_id", candidateId);

  rows.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
  return rows;
}

/** 인재 탐색 요건 목록 (활성 우선) */
export async function listTalentSearchRequirements(sb, { activeOnly = true } = {}) {
  let query = sb
    .from("talent_search_requirements")
    .select(
      `id, title, category, keywords, platforms, career_hint, notes, is_active, created_at, updated_at, created_by,
       notify:talent_search_requirement_notify(id, email, staff_id, notify_enabled, created_at)`,
    )
    .order("created_at", { ascending: false });
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const creatorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  /** @type {Map<string, any>} */
  const creators = new Map();
  if (creatorIds.length) {
    const { data: staffRows } = await sb
      .from("staff_profiles")
      .select("id, nickname, display_name, email")
      .in("id", creatorIds);
    for (const s of staffRows || []) creators.set(s.id, s);
  }
  return rows.map((r) => ({ ...r, creator: creators.get(r.created_by) || null }));
}

/**
 * 탐색 요건 등록 + 알림 수신자.
 * creatorEmail 은 자동 포함(notify on). extraEmails 도 기본 on.
 * staff 이메일이면 digest 알림도 켠다.
 */
export async function createTalentSearchRequirement(
  sb,
  {
    createdBy,
    title,
    category = null,
    keywords = "",
    platforms = [],
    careerHint = "",
    notes = "",
    notifyEmails = [],
  },
) {
  const { data: req, error } = await sb
    .from("talent_search_requirements")
    .insert({
      created_by: createdBy,
      title: String(title || "").trim(),
      category: category || null,
      keywords: String(keywords || "").trim() || null,
      platforms: Array.isArray(platforms) ? platforms.filter(Boolean) : [],
      career_hint: String(careerHint || "").trim() || null,
      notes: String(notes || "").trim() || null,
      is_active: true,
    })
    .select("id, title, category, keywords, platforms, career_hint, notes, is_active, created_at, created_by")
    .single();
  if (error) throw error;

  const emails = [
    ...new Set(
      (notifyEmails || [])
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];

  // 등록자 이메일 자동 포함
  const { data: creator } = await sb
    .from("staff_profiles")
    .select("id, email")
    .eq("id", createdBy)
    .maybeSingle();
  if (creator?.email) emails.unshift(String(creator.email).trim().toLowerCase());

  const uniqueEmails = [...new Set(emails)];
  if (uniqueEmails.length) {
    const notifyRows = [];
    for (const email of uniqueEmails) {
      const { data: hit } = await sb
        .from("staff_profiles")
        .select("id, email")
        .ilike("email", email)
        .maybeSingle();
      notifyRows.push({
        requirement_id: req.id,
        email,
        staff_id: hit?.id ?? null,
        notify_enabled: true,
      });
    }
    const { error: nErr } = await sb.from("talent_search_requirement_notify").insert(notifyRows);
    if (nErr) throw nErr;

    // 참조된 staff 는 다이제스트 알림 자동 on (실시간 설정은 유지)
    const staffIds = [...new Set(notifyRows.map((r) => r.staff_id).filter(Boolean))];
    for (const sid of staffIds) {
      const { data: st } = await sb
        .from("staff_profiles")
        .select("id, notify_digest, notify_realtime, notify_pref")
        .eq("id", sid)
        .maybeSingle();
      if (!st || st.notify_digest) continue;
      const patch = { notify_digest: true };
      if (st.notify_pref === "none") {
        patch.notify_pref = st.notify_realtime ? "realtime" : "digest";
      }
      await sb.from("staff_profiles").update(patch).eq("id", sid);
    }
  }

  return req;
}

export async function setTalentRequirementNotifyEnabled(sb, notifyId, enabled) {
  const { data, error } = await sb
    .from("talent_search_requirement_notify")
    .update({ notify_enabled: Boolean(enabled) })
    .eq("id", notifyId)
    .select("id, email, notify_enabled, requirement_id")
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateTalentSearchRequirement(sb, requirementId) {
  const { data, error } = await sb
    .from("talent_search_requirements")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", requirementId)
    .select("id, is_active")
    .single();
  if (error) throw error;
  return data;
}

/** email 로 staff 조회 (참조 메일 등록용) */
export async function findStaffByEmail(sb, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const { data, error } = await sb
    .from("staff_profiles")
    .select("id, email, nickname, display_name, role, is_active")
    .ilike("email", e)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** 로그인 화면 — 정보 등록 요청 (anon insert, select 없이 — anon SELECT 정책 없음) */
export async function submitAccessRequest(sb, { email, displayName = "", message = "" }) {
  const row = {
    email: String(email || "").trim().toLowerCase(),
    display_name: String(displayName || "").trim() || null,
    message: String(message || "").trim() || null,
    status: "pending",
  };
  if (!row.email.includes("@")) throw new Error("이메일을 확인하세요");
  // insert().select() 는 RETURNING + SELECT RLS 가 필요해 anon에서 실패함
  const { error } = await sb.from("access_requests").insert(row);
  if (error) throw error;
  return { ok: true };
}
