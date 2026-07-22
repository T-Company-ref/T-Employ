/** 공고/인재 카테고리 (QA · 개발 · 사무지원) — web 클라이언트용 */

export const JOB_CATEGORIES = [
  { id: "all", label: "전체", short: "전체" },
  { id: "qa", label: "QA·테스트", short: "QA" },
  { id: "dev", label: "개발", short: "개발" },
  { id: "office", label: "사무지원", short: "사무" },
  { id: "other", label: "미분류", short: "기타" },
];

const RULES = [
  {
    id: "qa",
    patterns: [/QA/i, /품질\s*검증/, /품질보증/, /테스터/, /테스트/, /성능\s*검증/, /SW\s*테스터/i],
  },
  {
    id: "dev",
    patterns: [
      /개발자/,
      /개발\s*연구/,
      /개발연구소/,
      /백엔드/,
      /프론트/,
      /풀스택/,
      /프로그래머/,
      /소프트웨어\s*엔지니어/,
      /웹\s*개발/,
      /앱\s*개발/,
      /AI\s*개발/i,
      /자동화\s*개발/,
    ],
  },
  {
    id: "office",
    patterns: [/사무\s*지원/, /사무\s*행정/, /사무행정/, /총무/, /사내\s*환경/, /행정\s*보조/, /장애인\s*채용/],
  },
];

export function classifyJobText(...parts) {
  const text = parts.filter(Boolean).join(" · ").trim();
  if (!text) return "other";
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.id;
  }
  return "other";
}

export function resolveTalentCategory(row) {
  if (row?.category && row.category !== "other") return row.category;
  const meta = row?.profile_meta || {};
  return classifyJobText(
    row?.search_condition,
    row?.headline,
    row?.summary_text,
    ...(meta.roles || []),
    ...(meta.skills || []),
    ...(meta.badges || []),
  );
}

export function categoryLabel(id) {
  return JOB_CATEGORIES.find((c) => c.id === id)?.label || "미분류";
}

export function categoryShort(id) {
  return JOB_CATEGORIES.find((c) => c.id === id)?.short || "기타";
}
