/** 단계·상태 한글 라벨 */

export const STAGE_LABELS = {
  applied: "지원",
  screening_pass: "서류통과",
  interviewing: "면접중",
  interview_rejected: "면접탈락",
  offer: "제안",
  hired: "입사",
  closed_lost: "종료",
  employed_elsewhere: "타사입사",
  blocked: "블락",
};

export const PROPOSAL_STATUS_LABELS = {
  sourced: "수집",
  proposed: "제안함",
  accepted: "수락",
  declined: "거절",
  no_response: "무응답",
  blocked: "블락",
};

export const PLATFORM_LABELS = {
  jobkorea: "잡코리아",
  saramin: "사람인",
};

/** 목록·상세에서 텍스트 태그 대신 쓰는 플랫폼 아이콘 */
export const PLATFORM_ICONS = {
  jobkorea: { emoji: "💼", label: "잡코리아" },
  saramin: { emoji: "👔", label: "사람인" },
};

export const TAG_LABELS = {
  recommend: "추천",
  watch: "관찰",
  flag: "주의",
};

/** staff_profiles.role */
export const ROLE_LABELS = {
  operator: "운영자",
  recruiter: "채용담당",
  executive: "임원",
  recommender: "추천자",
  viewer: "조회자",
  staff: "직원",
};

/** staff_profiles.notify_pref */
export const NOTIFY_PREF_LABELS = {
  none: "알림 안 받음",
  digest: "아침 다이제스트만 (07:30)",
  realtime: "실시간 알림",
};

export const MEETING_LABELS = {
  onsite: "대면",
  online: "화상",
  phone: "전화",
};

export const INTERVIEW_RESULT_LABELS = {
  scheduled: "예정",
  pass: "합격",
  fail: "불합격",
  no_show: "불참",
  canceled: "취소",
};

export function label(map, key, fallback = "—") {
  if (!key) return fallback;
  return map[key] ?? key;
}

export function platformLabel(p) {
  return label(PLATFORM_LABELS, p, p || "—");
}

export function platformIcon(p, { large = false } = {}) {
  const info = PLATFORM_ICONS[p] || { emoji: "📋", label: platformLabel(p) };
  const cls = large ? "platform-icon platform-icon-lg" : "platform-icon";
  return `<span class="${cls}" title="${info.label}" aria-label="${info.label}">${info.emoji}</span>`;
}

export function stageLabel(s) {
  return label(STAGE_LABELS, s, s || "—");
}

export function proposalLabel(s) {
  return label(PROPOSAL_STATUS_LABELS, s, s || "—");
}

export function roleLabel(r) {
  return label(ROLE_LABELS, r, r || "—");
}

export function notifyPrefLabel(p) {
  return label(NOTIFY_PREF_LABELS, p, p || "—");
}

/** 역할별 UI 권한 */
export function staffCaps(role) {
  const r = role || "viewer";
  const manage = r === "operator" || r === "recruiter";
  const recommend = manage || r === "recommender" || r === "executive";
  return {
    canRecommend: recommend,
    canTagExtra: manage, // 관찰/주의 등
    canManagePipeline: manage, // 단계·면접·블락
    canBlock: manage,
  };
}
