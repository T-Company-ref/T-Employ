/**
 * 채용 카테고리: QA / 개발 / 사무지원
 * 공고 제목·지원 포지션·인재 스킬·헤드라인에서 휴리스틱 분류.
 */
export type JobCategory = 'qa' | 'dev' | 'office' | 'other';

export interface JobCategoryMeta {
  id: JobCategory;
  label: string;
  short: string;
}

export const JOB_CATEGORY_META: JobCategoryMeta[] = [
  { id: 'qa', label: 'QA·테스트', short: 'QA' },
  { id: 'dev', label: '개발', short: '개발' },
  { id: 'office', label: '사무지원', short: '사무' },
  { id: 'other', label: '미분류', short: '기타' },
];

export const JOB_CATEGORY_IDS = JOB_CATEGORY_META.map((c) => c.id);

const RULES: Array<{ id: Exclude<JobCategory, 'other'>; patterns: RegExp[] }> = [
  {
    id: 'qa',
    patterns: [
      /QA/i,
      /품질\s*검증/,
      /품질보증/,
      /테스터/,
      /테스트/,
      /성능\s*검증/,
      /SW\s*테스터/i,
      /소프트웨어\s*앱\s*성능/,
    ],
  },
  {
    id: 'dev',
    patterns: [
      /개발자/,
      /개발\s*연구/,
      /개발연구소/,
      /백엔드/,
      /프론트/,
      /풀스택/,
      /프로그래머/,
      /소프트웨어\s*엔지니어/,
      /SW\s*개발/i,
      /웹\s*개발/,
      /앱\s*개발/,
      /AI\s*개발/i,
      /자동화\s*개발/,
    ],
  },
  {
    id: 'office',
    patterns: [/사무\s*지원/, /사무\s*행정/, /사무행정/, /총무/, /사내\s*환경/, /행정\s*보조/, /장애인\s*채용/],
  },
];

export function categoryLabel(id: string | null | undefined): string {
  return JOB_CATEGORY_META.find((c) => c.id === id)?.label ?? '미분류';
}

export function categoryShort(id: string | null | undefined): string {
  return JOB_CATEGORY_META.find((c) => c.id === id)?.short ?? '기타';
}

/** 텍스트 묶음에서 카테고리 추론 (우선순위: QA → 개발 → 사무) */
export function classifyJobText(...parts: Array<string | null | undefined>): JobCategory {
  const text = parts.filter(Boolean).join(' · ').trim();
  if (!text) return 'other';
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.id;
  }
  return 'other';
}

export function classifyPostingTitle(title: string | null | undefined): JobCategory {
  return classifyJobText(title);
}

export function classifyApplicantPosition(
  position: string | null | undefined,
  postingTitle?: string | null,
): JobCategory {
  const fromPos = classifyJobText(position);
  if (fromPos !== 'other') return fromPos;
  return classifyJobText(postingTitle);
}

export function classifyTalentProfile(input: {
  headline?: string | null;
  summaryText?: string | null;
  searchCondition?: string | null;
  skills?: string[] | null;
  roles?: string[] | null;
  badges?: string[] | null;
}): JobCategory {
  return classifyJobText(
    input.searchCondition,
    input.headline,
    input.summaryText,
    ...(input.roles ?? []),
    ...(input.skills ?? []),
    ...(input.badges ?? []),
  );
}
