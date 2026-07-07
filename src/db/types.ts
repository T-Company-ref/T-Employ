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
  stage?: ApplicationStage;
}

/** 커넥터가 반환하는 정규화된 인재검색 후보 레코드 */
export interface NormalizedTalent {
  platform: Platform;
  profileRef: string;
  profileUrl?: string;
  name?: string;
  headline?: string;
  summaryText?: string;
  searchCondition?: string;
  sourcedAt: string; // ISO
}
