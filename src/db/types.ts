export type Platform = 'jobkorea' | 'saramin' | string;

export type CrawlJobType = 'applicants' | 'talent_pool' | 'refresh_session';
export type CrawlJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface CrawlJob {
  id: string;
  job_type: CrawlJobType;
  platform: Platform;
  status: CrawlJobStatus;
  requested_by: string | null;
  trigger_type: 'manual' | 'schedule';
  stats: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type ApplicationStage =
  | 'applied'
  | 'screening_pass'
  | 'interviewing'
  | 'interview_rejected'
  | 'offer'
  | 'hired'
  | 'closed_lost'
  | 'employed_elsewhere'
  | 'blocked';

export interface Candidate {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source_type: 'applicant' | 'talent_pool';
  is_active: boolean;
  merged_into: string | null;
  created_at: Date;
  updated_at: Date;
}

/** 지원자 목록 행에서 추출한 부가 정보 */
export interface ApplicantProfileMeta {
  position?: string;
  gender?: string;
  age?: string;
  genderAge?: string;
  recommendTags?: string[];
  educationLevel?: string;
  educationSchool?: string;
  educationMajor?: string;
  careerTotal?: string;
  careerHistory?: string[];
  desiredSalary?: string;
  platformStatus?: string;
  readStatus?: string;
  detailUrl?: string;
}

/** 공고 관리 목록에서 추출한 부가 정보 */
export interface PostingMeta {
  postingNumber?: string;
  giNo?: string;
  status?: string;
  manager?: string;
  period?: string;
  registeredAt?: string;
  modifiedAt?: string;
  dday?: string;
  viewUrl?: string;
  applicantListUrl?: string;
  applicantCounts?: Record<string, number>;
}

/** 커넥터가 반환하는 정규화된 지원자 레코드 */
export interface NormalizedApplicant {
  platform: Platform;
  externalRef: string;
  name?: string;
  email?: string;
  phone?: string;
  appliedAt: string; // ISO
  postingExternalId?: string;
  postingTitle?: string;
  postingMeta?: PostingMeta;
  profileMeta?: ApplicantProfileMeta;
  stage?: ApplicationStage;
  resumePdf?: Buffer;
}

/** 잡코리아 인재검색 카드에서 추출한 부가 정보 */
export interface TalentProfileMeta {
  genderAge?: string;
  careerText?: string;
  company?: string;
  roles?: string[];
  skills?: string[];
  badges?: string[];
  /** 구직/재직 상태 원문 (예: 구직중, 재직중, 취업완료) */
  jobStatus?: string;
}

/** 커넥터가 반환하는 정규화된 인재검색 후보 레코드 */
export interface NormalizedTalent {
  platform: Platform;
  profileRef: string;
  profileUrl?: string;
  name?: string;
  headline?: string;
  summaryText?: string;
  profileMeta?: TalentProfileMeta;
  searchCondition?: string;
  sourcedAt: string; // ISO
  /** 크롤 시 이력서 PDF 바이트 (선택) */
  resumePdf?: Buffer;
}
