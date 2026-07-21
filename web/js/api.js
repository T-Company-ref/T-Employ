/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

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
    .select("id, nickname, display_name, email, role, is_active, auth_user_id, notify_pref")
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
    is_active: true,
    auth_user_id: user.id,
    _unlinked: true,
  };
}

/** 본인 프로필: 별명·표시명·알림 설정 (역할 변경 불가) */
export async function updateMyStaffProfile(sb, staffId, { nickname, displayName, notifyPref }) {
  const patch = {};
  if (nickname != null) patch.nickname = String(nickname).trim();
  if (displayName != null) patch.display_name = String(displayName).trim();
  if (notifyPref != null) patch.notify_pref = notifyPref;
  const { data, error } = await sb
    .from("staff_profiles")
    .update(patch)
    .eq("id", staffId)
    .select("id, nickname, display_name, email, role, is_active, auth_user_id, notify_pref")
    .single();
  if (error) throw error;
  return data;
}

export async function listPostings(sb, { q = "", platform = "", limit = 100 } = {}) {
  let query = sb
    .from("job_postings")
    .select("id, platform, title, external_posting_id, source_url, meta, opened_at, closed_at, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  let counts = {};
  if (ids.length) {
    const { data: apps, error: appErr } = await sb
      .from("applications")
      .select("posting_id")
      .in("posting_id", ids);
    if (appErr) throw appErr;
    for (const a of apps ?? []) {
      if (!a.posting_id) continue;
      counts[a.posting_id] = (counts[a.posting_id] || 0) + 1;
    }
  }

  const needle = q.trim().toLowerCase();
  return rows
    .map((r) => ({ ...r, applicant_count: counts[r.id] || 0 }))
    .filter((row) => {
      if (!needle) return true;
      const hay = [row.title, row.external_posting_id, row.platform, row.meta?.manager, row.meta?.postingNumber]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
}

function dayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildDailySeries(rows, dateField, days = 14) {
  const counts = {};
  for (const row of rows) {
    const k = dayKey(row[dateField]);
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  const labels = [];
  const values = [];
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const k = dayKey(d.toISOString());
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    values.push(counts[k] || 0);
  }
  return { labels, values };
}

export async function getDashboardStats(sb) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const [
    apps,
    talents,
    postings,
    docs,
    recentApps,
    stageRows,
    appDates,
    talentDates,
    platformRows,
  ] = await Promise.all([
    sb.from("applications").select("id", { count: "exact", head: true }),
    sb.from("talent_pool_candidates").select("id", { count: "exact", head: true }),
    sb.from("job_postings").select("id", { count: "exact", head: true }),
    sb.from("candidate_documents").select("id", { count: "exact", head: true }),
    sb
      .from("applications")
      .select(
        `id, applied_at, current_stage, platform,
         candidate:candidates ( name ),
         posting:job_postings ( title )`,
      )
      .order("applied_at", { ascending: false })
      .limit(10),
    sb.from("applications").select("current_stage"),
    sb
      .from("applications")
      .select("applied_at")
      .gte("applied_at", sinceIso)
      .order("applied_at", { ascending: true })
      .limit(2000),
    sb
      .from("talent_pool_candidates")
      .select("created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(2000),
    sb.from("applications").select("platform"),
  ]);

  for (const r of [
    apps,
    talents,
    postings,
    docs,
    recentApps,
    stageRows,
    appDates,
    talentDates,
    platformRows,
  ]) {
    if (r.error) throw r.error;
  }

  const byStage = {};
  for (const row of stageRows.data ?? []) {
    const k = row.current_stage || "unknown";
    byStage[k] = (byStage[k] || 0) + 1;
  }

  const byPlatform = {};
  for (const row of platformRows.data ?? []) {
    const k = row.platform || "unknown";
    byPlatform[k] = (byPlatform[k] || 0) + 1;
  }

  return {
    applicants: apps.count ?? 0,
    talents: talents.count ?? 0,
    postings: postings.count ?? 0,
    documents: docs.count ?? 0,
    byStage,
    byPlatform,
    recentApps: recentApps.data ?? [],
    appsDaily: buildDailySeries(appDates.data ?? [], "applied_at", 14),
    talentsDaily: buildDailySeries(talentDates.data ?? [], "created_at", 14),
  };
}

export async function listApplications(sb, { q = "", platform = "", limit = 100 } = {}) {
  let query = sb
    .from("applications")
    .select(
      `
      id, platform, applied_at, current_stage, is_active, external_ref, profile_meta,
      candidate:candidates!inner ( id, name, email, phone, is_active, source_type ),
      posting:job_postings ( id, title, external_posting_id, source_url, meta )
    `,
    )
    .order("applied_at", { ascending: false })
    .limit(limit);

  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;

  const needle = q.trim().toLowerCase();
  if (!needle) return data ?? [];
  return (data ?? []).filter((row) => {
    const hay = [
      row.candidate?.name,
      row.candidate?.email,
      row.candidate?.phone,
      row.posting?.title,
      row.platform,
      row.current_stage,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

export async function listTalents(sb, { q = "", platform = "", limit = 500 } = {}) {
  let query = sb
    .from("talent_pool_candidates")
    .select(
      `
      id, platform, profile_url, profile_ref, headline, summary_text, profile_meta,
      search_condition, proposal_status, is_active, sourced_at, created_at,
      candidate:candidates ( id, name, email, phone, is_active )
    `,
    )
    .eq("is_active", true)
    .order("sourced_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;

  const needle = q.trim().toLowerCase();
  if (!needle) return data ?? [];
  return (data ?? []).filter((row) => {
    const hay = [
      row.candidate?.name,
      row.headline,
      row.summary_text,
      row.platform,
      row.proposal_status,
      row.search_condition,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
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

  const select =
    "id, doc_type, file_url, file_hash, collected_at, application_id, talent_pool_id, candidate_id";

  if (applicationId) {
    const { data, error } = await sb
      .from("candidate_documents")
      .select(select)
      .eq("application_id", applicationId)
      .order("collected_at", { ascending: false });
    if (error) throw error;
    pushAll(data);
  }

  if (talentPoolId) {
    const { data, error } = await sb
      .from("candidate_documents")
      .select(select)
      .eq("talent_pool_id", talentPoolId)
      .order("collected_at", { ascending: false });
    if (error) throw error;
    pushAll(data);
  }

  if (candidateId) {
    const { data, error } = await sb
      .from("candidate_documents")
      .select(select)
      .eq("candidate_id", candidateId)
      .order("collected_at", { ascending: false });
    if (error) throw error;
    pushAll(data);
  }

  rows.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
  return rows;
}
