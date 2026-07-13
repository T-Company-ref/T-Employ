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

export const TAG_LABELS = {
  recommend: "추천",
  watch: "관찰",
  flag: "주의",
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

export function stageLabel(s) {
  return label(STAGE_LABELS, s, s || "—");
}

export function proposalLabel(s) {
  return label(PROPOSAL_STATUS_LABELS, s, s || "—");
}
