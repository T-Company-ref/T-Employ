# Phase 0 산출물 - 사전 준비

## 1) 운영 계정 (platform_accounts)

| platform | account_alias | login_policy | 비고 |
|----------|---------------|--------------|------|
| jobkorea | tbell-corp | session_reuse | 잡코리아 기업계정 (전용 운영계정) |
| saramin | tbell-corp | session_reuse | 사람인 기업계정 (전용 운영계정) |

- 개인 계정 사용 금지, 전용 운영 계정만 사용.
- 비밀번호/TOTP 는 DB에 저장하지 않고 GitHub Secrets 에서만 조회.

## 2) Secrets / 환경변수 목록

### DB
| 키 | 설명 |
|----|------|
| `DATABASE_URL` | Postgres 연결 문자열 (Supabase/RDS/로컬) |
| `PGSSL` | 클라우드 DB 사용 시 `true` |

### 세션
| 키 | 설명 |
|----|------|
| `SESSION_ENC_KEY` | 세션 파일 암호화 키 |

### 플랫폼 계정
| 키 | 설명 |
|----|------|
| `JOBKOREA_USERNAME` / `JOBKOREA_PASSWORD` / `JOBKOREA_TOTP_SECRET` | 잡코리아 로그인 |
| `SARAMIN_USERNAME` / `SARAMIN_PASSWORD` / `SARAMIN_TOTP_SECRET` | 사람인 로그인 |

### 메일
| 키 | 설명 |
|----|------|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | SMTP 발송 |
| `MAIL_FROM` | 발신 주소 |
| `DAILY_REPORT_RECIPIENTS` | 요약 수신자 (쉼표 구분) |

## 3) 로그인 후 이동 경로 (Route Map)

경로 설정은 `config/routes/{platform}.yaml` 에서 관리한다.

정의된 route:
- `home` — 로그인 후 홈
- `applicants_list` — 공고 지원자 목록
- `talent_pool_list` — 인재검색/포지션 제안(잡코리아) / 인재풀(사람인)

각 route 는 `path_from_home`(이동 단계) + `ready_selector`(성공 판정) + `pagination` 으로 구성.
실제 CSS 셀렉터는 `selectors` 블록에 채우며, dry-run 은 `npm run dev:check` 로 검증한다.

## 4) DB 스키마 (마이그레이션)

| 파일 | 내용 |
|------|------|
| `0001_init.sql` | 확장, 트리거 함수, staff_profiles |
| `0002_platform.sql` | platform_accounts/sessions/configs/routes/health |
| `0003_recruiting.sql` | job_postings, posting_snapshots, candidates, applications, candidate_documents, talent_pool_candidates |
| `0004_collaboration.sql` | candidate_tags, tag_audit_logs, candidate_status_history, interview_events, mail_jobs |
| `0005_crawl.sql` | crawl_jobs, crawl_failures, crawl_logs |

## 5) Phase 0 완료 기준

- [x] 운영 계정/Secrets 목록 정의
- [x] 잡코리아/사람인 Route Map 초안 작성
- [x] 공통 DB 스키마 초안 확정 (마이그레이션 5종)
- [ ] 실제 로그인 후 인재검색 화면까지 셀렉터 확정 (`npm run dev:check` 통과)
- [ ] 공고지원/인재검색 각각 최소 1건 저장 성공

> 마지막 2개 항목은 실제 기업계정 자격증명이 주입된 환경에서 수행한다.
