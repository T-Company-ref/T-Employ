/** 단계·상태 한글 라벨 */

export const STAGE_LABELS = {
  applied: "지원",
  screening_pass: "서류통과",
  interviewing: "면접중",
  interview_rejected: "면접탈락",
  offer: "제안",
  hired: "입사",
  closed_lost: "불합격",
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

import { Icon } from "./icons.js";

/** 목록·상세에서 텍스트 태그 대신 쓰는 플랫폼 아이콘 */
export const PLATFORM_ICONS = {
  jobkorea: { icon: "jobkorea", label: "잡코리아" },
  saramin: { icon: "saramin", label: "사람인" },
};

export const TAG_LABELS = {
  recommend: "추천",
  watch: "관찰",
  flag: "주의",
};

/** staff_profiles.role — 운영자 / 추천자 / 조회자 (레거시는 표시만 매핑) */
export const ROLE_LABELS = {
  operator: "운영자",
  recommender: "추천자",
  viewer: "조회자",
  recruiter: "운영자", // 레거시 → 운영자
  executive: "추천자", // 레거시 → 추천자
  staff: "조회자", // 레거시 → 조회자
};

/** staff_profiles.notify_pref (레거시) */
export const NOTIFY_PREF_LABELS = {
  none: "알림 안 받음",
  digest: "아침 다이제스트만 (07:30)",
  realtime: "실시간 알림",
};

export const POSTING_STATUS_SIDE = {
  open: "진행 중",
  closed: "마감",
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
  const info = PLATFORM_ICONS[p] || { icon: "platform", label: platformLabel(p) };
  const cls = large ? "platform-icon platform-icon-lg" : "platform-icon";
  const size = large ? 20 : 16;
  const render = Icon[info.icon] || Icon.platform;
  return `<span class="${cls}" title="${info.label}">${render({ size, label: info.label })}</span>`;
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

/** 역할별 UI 권한 — 운영자 / 추천자 / 조회자 */
export function staffCaps(role) {
  const r = role || "viewer";
  // recruiter는 레거시 운영자 동등
  const manage = r === "operator" || r === "recruiter";
  // executive는 레거시 추천자 동등
  const recommend = manage || r === "recommender" || r === "executive";
  return {
    canRecommend: recommend,
    canTagExtra: manage, // 관찰/주의 등
    canManagePipeline: manage, // 단계·면접·블락
    canBlock: manage,
  };
}
