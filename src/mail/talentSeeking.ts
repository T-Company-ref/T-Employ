/**
 * 인재검색 후보의 구직(취직 전) 여부 판별.
 * - 취업완료/입사완료 등은 제외
 * - 구직중·이직희망·재직중·신입·불명은 포함 (재직중이어도 이직 후보로 봄)
 */

const EMPLOYED_DONE =
  /취업\s*완료|입사\s*완료|입사\s*확정|채용\s*완료|입사\s*예정|제안\s*마감/;

const UNAVAILABLE =
  /삭제된?\s*이력서|열람\s*(할\s*)?수\s*없|열람\s*불가|비공개\s*(처리|이력서)|존재하지\s*않는\s*(이력서|페이지)|비정상적인\s*경로/;

const SEEKING_HINT =
  /구직\s*중|이직\s*희망|즉시\s*출근|입사\s*가능|재직\s*중|신입|경력\s*무관|프리랜서/;

export type SeekingVerdict = 'seeking' | 'hired' | 'unavailable' | 'unknown';

export function classifySeekingText(text: string | null | undefined): SeekingVerdict {
  if (!text) return 'unknown';
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'unknown';
  if (EMPLOYED_DONE.test(t)) return 'hired';
  if (UNAVAILABLE.test(t)) return 'unavailable';
  if (SEEKING_HINT.test(t)) return 'seeking';
  return 'unknown';
}

export function talentBlob(meta: {
  jobStatus?: string | null;
  badges?: string[] | null;
  careerText?: string | null;
  headline?: string | null;
  summaryText?: string | null;
  company?: string | null;
}): string {
  return [
    meta.jobStatus,
    ...(meta.badges ?? []),
    meta.careerText,
    meta.headline,
    meta.summaryText,
    meta.company,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** DB 메타만으로 메일 후보 가능 여부 (취업완료면 false) */
export function isSeekingCandidateFromMeta(meta: {
  jobStatus?: string | null;
  badges?: string[] | null;
  careerText?: string | null;
  headline?: string | null;
  summaryText?: string | null;
  company?: string | null;
}): boolean {
  const v = classifySeekingText(talentBlob(meta));
  return v !== 'hired' && v !== 'unavailable';
}
