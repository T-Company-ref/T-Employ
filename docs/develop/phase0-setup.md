# Phase 0 산출물 - 사전 준비

## 현재 플랫폼 진행 상태 (2026-07-10)

| 플랫폼 | 상태 | Route Map | 로그인 | 수집 |
|--------|------|-----------|--------|------|
| **잡코리아** | 진행 중 | `config/routes/jobkorea.yaml` | 기업회원 ✅ | Phase 1 착수 |
| **사람인** | **인증 대기** | `config/routes/saramin.yaml` | 기업회원 ✅ | 2단계 인증 후 재개 |

> 개발·검증은 **잡코리아 우선**. 사람인은 Route Map·계정은 준비됐으나, 이력서/인재풀 열람용 **2단계 인증** 완료 전까지 수집 보류.

---

## 1) 운영 계정 (platform_accounts)

| platform | account_alias | login_policy | 상태 | 비고 |
|----------|---------------|--------------|------|------|
| jobkorea | tbell-corp | session_reuse | **활성** | 잡코리아 기업계정, 수집 진행 대상 |
| saramin | tbell-corp | session_reuse | **인증 대기** | 기업 로그인까지 성공, 2단계 인증·세션 저장 대기 |

- 개인 계정 사용 금지, 전용 운영 계정만 사용.
- 비밀번호/TOTP 는 DB에 저장하지 않고 GitHub Secrets / `.env` 에서만 조회.

### 사람인 2단계 인증 (인증 대기)

이력서 열람·인재풀 이용 시 SMS 또는 이메일 인증 필요. **인증 1회 = 6개월 유효**(쿠키 기반).

```bash
npm run dev:session -- saramin
```

브라우저에서 인증번호 입력 → 완료 시 `.sessions/saramin_tbell-corp.json` 에 세션 저장.

---

## 2) Secrets / 환경변수 목록

### DB
| 키 | 설명 |
|----|------|
| `DATABASE_URL` | (선택) 호스티드 Postgres 연결 문자열. **비우면 임베디드 PGlite 사용** (계정/Docker 불필요) |
| `PGSSL` | 호스티드 DB 사용 시 `true` |
| `PGLITE_DIR` | 임베디드 DB 파일 위치 (기본 `data/pgdata`) |

CI 지속성: 임베디드 모드에서는 GitHub Actions 가 `db-snapshot` 브랜치에 스냅샷을 유지한다(`.github/actions/db-load`·`db-save`). 별도 Secret 불필요(기본 `GITHUB_TOKEN` 사용).

### Supabase (인터랙티브 UI용, Phase 3.5)
| 키 | 설명 |
|----|------|
| `SUPABASE_URL` | API URL (`https://[ref].supabase.co`) |
| `SUPABASE_ANON_KEY` | 브라우저용 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버/Actions용 (선택) |

상세: `docs/develop/supabase-setup.md`

### 세션
| 키 | 설명 |
|----|------|
| `SESSION_ENC_KEY` | 세션 파일 암호화 키 |

### 플랫폼 계정
| 키 | 설명 |
|----|------|
| `JOBKOREA_USERNAME` / `JOBKOREA_PASSWORD` / `JOBKOREA_TOTP_SECRET` | 잡코리아 기업 로그인 (**현재 사용 중**) |
| `SARAMIN_USERNAME` / `SARAMIN_PASSWORD` / `SARAMIN_TOTP_SECRET` | 사람인 기업 로그인 (2단계 인증 대기) |

### 메일 (Gmail SMTP)

발신: **`MAIL_FROM`** 예) `T-Employ <tbell.wr@gmail.com>`  
수신(운영 알림): Repository Variable `ACTION_NOTIFY_EMAIL` (기본 `yj.kim@tbell.co.kr`)

| 키 | 설명 |
|----|------|
| `GMAIL_USER` | `tbell.wr@gmail.com` |
| `GMAIL_APP_PASSWORD` | Google **앱 비밀번호** 16자리 |
| `MAIL_FROM` | `T-Employ <tbell.wr@gmail.com>` |

앱 비밀번호: https://myaccount.google.com/apppasswords

```bash
npm run dev:mail-test
```

---

## 3) 로그인 후 이동 경로 (Route Map)

경로 설정은 `config/routes/{platform}.yaml` 에서 관리한다.

### 잡코리아 (검증 완료)

| route | URL | 비고 |
|-------|-----|------|
| login | `/Login/` + 기업회원 탭(`pre_steps`) | 통합 로그인, 기본값은 개인회원 |
| home | `/Corp/Main` | 기업회원 홈 |
| applicants_list | `/Corp/Applicant/List` | 지원자관리 |
| talent_pool_list | `/corp/person/find` | 인재검색 |

검증: `npm run dev:login jobkorea`

### 사람인 (인증 대기)

| route | URL | 비고 |
|-------|-----|------|
| login | `/zf_user/auth` + 기업회원 탭(`pre_steps`) | |
| home | `hiring.saramin.co.kr/home` | 채용센터 |
| applicants_list | `hiring.saramin.co.kr/applicant-manage` | 2단계 인증 필요 |
| talent_pool_list | `.../talent-pool/main/search` | 2단계 인증 필요 |

검증: 로그인까지 `npm run dev:login saramin` — 데이터 열람은 `npm run dev:session -- saramin` 후

---

## 4) DB 스키마 (마이그레이션)

| 파일 | 내용 |
|------|------|
| `0001_init.sql` | 트리거 함수, staff_profiles (gen_random_uuid 코어 내장) |
| `0002_platform.sql` | platform_accounts/sessions/configs/routes/health |
| `0003_recruiting.sql` | job_postings, posting_snapshots, candidates, applications, candidate_documents, talent_pool_candidates |
| `0004_collaboration.sql` | candidate_tags, tag_audit_logs, candidate_status_history, interview_events, mail_jobs |
| `0005_crawl.sql` | crawl_jobs, crawl_failures, crawl_logs |

---

## 5) Phase 0 완료 기준

### 공통 (완료)
- [x] 운영 계정/Secrets 목록 정의
- [x] 공통 DB 스키마 초안 확정 (마이그레이션 5종)
- [x] 임베디드 DB(PGlite) `migrate`/`seed`/`dump`/`restore` 로컬 검증
- [x] Supabase 인프라(스키마/시드/RLS) 반영 — UI는 Phase 3.5
- [x] 로그인/라우트 스모크 테스트 도구 (`dev:login` / `dev:session`)

### 잡코리아 (Phase 1 완료)
- [x] Route Map + 기업회원 로그인·라우트 검증
- [x] 지원자 20건 / 인재검색 20건 DB 저장 (`crawl:applicants` / `crawl:talent`)

### 사람인 (인증 대기)
- [x] Route Map 초안 + 기업회원 로그인까지 검증
- [ ] **2단계 인증 완료 후 세션 저장** — `npm run dev:session -- saramin`
- [ ] (Phase 1 후반) 1건 저장

> Phase 0·1(잡코리아) 완료. 다음: 사람인 2단계 인증 → Phase 2 자동 cron 활성화.
