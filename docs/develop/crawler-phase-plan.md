# TBELL Employ Crawler Phase Plan

## Phase 진행 체크리스트

- [~] Phase 0 진행 (사전준비)
  - [x] 운영 계정/권한/Secrets 목록 정의 (`docs/develop/phase0-setup.md`)
  - [x] 잡코리아 Route Map 초안 작성 (`config/routes/jobkorea.yaml`)
  - [x] 사람인 Route Map 초안 작성 (`config/routes/saramin.yaml`)
  - [x] 공통 DB 스키마 초안 확정 (`db/migrations/0001~0005`)
  - [x] 임베디드 DB(PGlite) 어댑터 + 마이그레이션/시드 로컬 검증 완료 (Docker 불필요)
  - [x] DB 스냅샷 덤프/복원 스크립트 검증 (`db:dump`/`db:restore`)
  - [ ] 실제 로그인 후 셀렉터 확정 (`npm run dev:check` 통과)
  - [ ] 공고지원/인재검색 각 1건 저장 성공
- [ ] Phase 1 완료 (수동 실행 MVP)
  - [ ] `crawl-applicants.yml` 수동 실행 성공
  - [ ] `crawl-talent-pool.yml` 수동 실행 성공
  - [ ] 잡코리아 지원자 20건 샘플 저장
  - [ ] 사람인 인재검색 20건 샘플 저장
  - [ ] 실패 로그/스크린샷 저장 확인
- [ ] Phase 2 완료 (자동 배치 + 안정화)
  - [ ] 18:00 applicants 배치 동작
  - [ ] 18:20 talent-pool 배치 동작
  - [ ] 세션 재사용/만료복구 동작
  - [ ] 중복 병합 규칙 검증
  - [ ] 7일 성공률 90% 이상
- [ ] Phase 3 완료 (협업 기능 + 리포트)
  - [ ] 추천 태그 + 작성자 추적 동작
  - [ ] 면접 일정/결과/노쇼 상태 동작
  - [ ] 07:50 집계 잡 동작
  - [ ] 08:00 메일 발송 동작
  - [ ] 발송 실패 재시도/경고 동작
- [ ] Phase 3.5 완료 (인터랙티브 웹 UI · Supabase)
  - [ ] Supabase 프로젝트 준비 + Secrets 등록 (사용자 5분 작업)
  - [ ] RLS 정책 + auth→staff_profiles 매핑 적용
  - [ ] 기업 이메일 로그인 동작
  - [ ] 웹에서 태그/면접/삭제상태 입력·수정 실시간 반영
  - [ ] 크롤러 DATABASE_URL → Supabase 전환 후 동일 데이터 공유 확인
- [ ] Phase 4 완료 (멀티 사이트 확장)
  - [ ] connector 인터페이스 표준 적용
  - [ ] `platform_configs` 기반 on/off 운영
  - [ ] 신규 사이트 1개 온보딩 리허설 완료
  - [ ] 사이트별 장애 격리 동작 검증

---

## 1) 목표

- 매일 18:00 KST 기준 사이트별 순차 수집 실행
- 다음날 08:00 KST 요약 메일 자동 발송
- 공고 지원자(Applicants)와 인재검색/포지션제안 후보(Talent Pool) 분리 운영
- 추천 태그(작성자 추적), 면접 일정/결과, 소프트 삭제 상태 관리

---

## 2) 핵심 전제

- GitHub Pages는 정적 UI만 담당한다.
- 실제 로그인/수집은 Runner(GitHub-hosted 또는 self-hosted)에서 수행한다.
- 플랫폼 UI 변경/로그인 정책 변경을 전제로 운영한다.
- "로그인 성공 = 수집 성공"이 아니다. 로그인 이후 네비게이션/필터/상세 진입 시나리오가 핵심이다.
- **DB는 기본적으로 임베디드 Postgres(PGlite)를 사용하며, 계정 가입·Docker·서버 설치가 모두 불필요하다.** 호스티드 DB로의 전환은 `DATABASE_URL` 환경변수 하나로 이루어진다.

---

## 2-1) DB / 실행 환경 전략 (설치·계정 Zero)

외부 서비스 가입과 로컬 Docker 상시 구동이 모두 불가능한 환경을 전제로 한다. 이를 위해 **임베디드 Postgres(PGlite)** 를 기본 드라이버로 채택한다.

| 항목 | 방식 |
|------|------|
| 기본 DB | 임베디드 PGlite (npm 패키지, 파일 저장 `data/pgdata`) |
| 계정/가입 | 불필요 |
| Docker | 불필요 |
| CI 지속성 | GitHub Actions가 스냅샷(`data/pgdata.tar.gz`)을 `db-snapshot` 브랜치에 강제 푸시 → 다음 실행 시 복원 |
| 호스티드 전환 | `DATABASE_URL=postgres://...` 설정 시 자동으로 node-postgres 드라이버로 전환 (코드 변경 없음) |

드라이버 자동 분기:
- `DATABASE_URL` 미설정/비-postgres → **PGlite**(임베디드)
- `DATABASE_URL`이 `postgres://` 로 시작 → **node-postgres**(Supabase/RDS/Neon 등)

동일한 SQL 마이그레이션(`db/migrations/*.sql`)이 두 드라이버 모두에서 그대로 동작한다. (`gen_random_uuid()`는 PG13+ 및 PGlite 코어 내장이라 별도 확장 불필요.)

### CI 데이터 지속성 메커니즘
GitHub Actions 러너는 매 실행마다 초기화되므로, 임베디드 DB는 다음 순서로 상태를 유지한다.

1. `db-load` 액션: `db-snapshot` 브랜치에서 `pgdata.tar.gz` 복원 → `db:migrate`
2. 잡 실행(크롤/집계/메일)
3. `db-save` 액션: `db:dump` → `db-snapshot` 브랜치로 **강제 푸시(단일 커밋 유지)**

`db-snapshot` 브랜치는 항상 1개 커밋만 유지하도록 force-push 하므로 저장소 히스토리가 누적 팽창하지 않는다. 모든 DB 쓰기 워크플로는 `concurrency: db-write` 그룹으로 직렬화되어 스냅샷 충돌을 방지한다.

### 나중에 호스티드 DB로 갈 때 (선택)
실시간 웹 쓰기(직원 로그인·추천 태그·면접 상태)를 UI에서 지원하려면 호스티드 DB가 유리하다. 이때는:
1. Supabase/Neon 등에서 프로젝트 생성 → Connection string 확보
2. GitHub Secrets 에 `DATABASE_URL` 등록 (있으면 CI가 자동으로 호스티드 모드)
3. 코드/스키마 수정 없이 `db:migrate` 재실행

---

## 2-2) GitHub Actions 사용량(Usage) / 비용

### 요금 기준
- **Public 레포: Actions 분(minutes) 무제한 무료**
- Private 레포(Free): 월 2,000분 / (Team) 3,000분 무료, ubuntu 러너 1x 배율

### 예상 소모량 (private 레포 가정, 캐시 적용 후)
| 워크플로 | 빈도 | 1회 소요 | 월 합계 |
|----------|------|---------|---------|
| crawl-applicants | 1일 1회 | ~6분 | ~180분 |
| crawl-talent-pool | 1일 1회 | ~6분 | ~180분 |
| compose-daily-report | 1일 1회 | ~2분 | ~60분 |
| send-daily-mail | 1일 1회 | ~2분 | ~60분 |
| **합계** | | | **~480분/월** |

→ Free 2,000분 한도 내 충분. Public 레포면 비용 걱정 없음.

### 적용된 사용량 절감
- `actions/setup-node`의 `cache: npm` + Playwright 브라우저 캐시(`~/.cache/ms-playwright`)로 설치 시간 단축 (회당 3~5분 절감)
- Playwright는 `--with-deps chromium` 단일 브라우저만 설치
- 스냅샷 크기(약 5MB)는 force-push 라 히스토리 누적 없음
- 수집 빈도/대상은 `platform_configs` 로 조절 (불필요한 사이트 off)
- 실패 재시도는 무한 루프 금지(최대 2~3회)

> 결론: Docker·외부 DB 가입 없이 임베디드 DB + 스냅샷 지속 + 캐시만으로 **자동 수집 파이프라인**은 완전히 돌아간다.

---

## 2-3) 웹 쓰기(인터랙티브) 아키텍처 — Supabase 계층

GitHub Pages는 정적 호스팅이라 브라우저에서 임베디드 DB로 직접 쓰기가 불가능하다. 따라서 **직원이 웹에서 로그인해 추천 태그·면접 상태·삭제(블락)를 입력/수정**하는 기능은 호스티드 DB(Supabase)를 통해 제공한다.

### 계층 분리(하이브리드)
| 계층 | 저장소 | 접근 주체 | 용도 |
|------|--------|-----------|------|
| 자동 수집 파이프라인 | Supabase Postgres (`DATABASE_URL`) | GitHub Actions | 크롤/집계/메일 쓰기 |
| 인터랙티브 UI | 동일 Supabase (JS 클라이언트 + Auth + RLS) | 브라우저(직원) | 로그인/태그/면접/삭제상태 |
| 로컬 개발/오프라인 | 임베디드 PGlite | 개발자 | 코드 변경 없이 로컬 실행 |

**단일 소스**: 크롤러(Actions)와 웹 UI가 같은 Supabase 인스턴스를 바라본다. 크롤러는 `DATABASE_URL`(Postgres 직결/서비스 롤)로, 브라우저는 Supabase JS(anon key + RLS)로 접속한다.

### 인증/권한
- 로그인: Supabase Auth(기업 이메일). 최초 로그인 시 `auth.users` → `staff_profiles` 자동 매핑(트리거).
- 권한: RLS(Row Level Security)로 역할별 접근 제어.
  - 조회: 인증된 직원 전체 허용
  - 협업 쓰기(`candidate_tags`/`interview_events`/`candidate_status_history`): 본인 actor 기록만 생성/수정
  - 삭제: 물리 삭제 금지, 소프트 삭제(상태 변경)만 허용
  - 크롤러(서비스 롤): RLS 우회하여 수집 데이터 적재
- Supabase 전용 SQL(RLS/트리거)은 `db/supabase/` 에 분리 보관하여 PGlite 마이그레이션 체인과 격리한다.

### 사용자 1회 준비(약 5분, 대체 불가)
계정 생성/키 발급은 소유 계정에서만 가능하다. 절차는 `docs/develop/supabase-setup.md` 참고. 이후 스키마·RLS·연동·배포는 전담 처리한다.

---

## 3) Phase 계획

## Phase 0. 사전준비 (3~5일)

### 범위
- 계정/권한/비밀관리 준비
- 사이트별 수집 시나리오 문서화
- 공통 데이터 스키마 정의

### 산출물
- `platform_accounts` 운영 리스트
- 환경변수/Secrets 키 목록
- 사이트별 "로그인 후 이동 경로" 문서
- 기본 DB 스키마 초안
- 임베디드 PGlite 어댑터 + 스냅샷 지속 파이프라인 (계정/Docker 불필요)

### 완료 기준
- `npm run db:migrate && npm run db:seed` 임베디드 DB에서 성공 (완료)
- `npm run db:dump`/`db:restore` 스냅샷 왕복 검증 (완료)
- 잡코리아/사람인 각각 수동 로그인 후 인재검색 화면까지 100% 재현
- 공고지원/인재검색 각각 최소 1건 저장 성공

---

## Phase 1. 수동 실행 MVP (1~2주)

### 범위
- Playwright 기반 로그인 + 지원자 수집 + 인재검색 수집
- 수동 트리거(`workflow_dispatch`)로 실행
- 실패 로그/스크린샷 저장

### 구현 항목
- `crawl-applicants.yml`, `crawl-talent-pool.yml`
- 공통 모듈:
  - `login()`
  - `gotoApplicantsPage()`
  - `gotoTalentPoolPage()`
  - `collectList()`, `collectDetail()`
  - `normalizeAndSave()`
- 실패 시 `crawl_failures` 기록 + screenshot 저장

### 완료 기준
- 잡코리아/사람인 각각:
  - 공고지원 20건 샘플 수집 성공
  - 인재검색 20건 샘플 수집 성공
- 실패 케이스(로그인 실패/목록 없음/상세 진입 실패) 분류 가능

---

## Phase 2. 자동 배치 + 안정화 (2주)

### 범위
- 18:00/18:20 자동 수집 스케줄 적용
- 세션 재사용/만료 복구
- 중복 제거/상태 동기화

### 구현 항목
- Cron:
  - `18:00` applicants crawl
  - `18:20` talent pool crawl
- 세션 전략:
  - 암호화 `storageState` 재사용
  - 로그인 리다이렉트 감지 시 재로그인
- 파이프라인 안정화:
  - concurrency lock
  - retry policy
  - 사이트별 timeout/rate-limit

### 완료 기준
- 최근 7일 기준 자동 배치 성공률 90% 이상
- 중복 후보 병합 규칙 동작 검증

---

## Phase 3. 협업 기능 + 리포트 자동화 (1~2주)

### 범위
- 추천 태그(작성자 추적)
- 면접 일정/결과/노쇼/입사완료/블락 상태
- 08:00 요약 메일 자동 발송

### 구현 항목
- `candidate_tags`, `tag_audit_logs`, `interview_events`, `candidate_status_history`
- 요약 집계 잡(`07:50`) + 메일 발송 잡(`08:00`)
- 소프트 삭제 정책:
  - 물리 삭제 금지
  - `blocked` 또는 `is_active=false`

### 완료 기준
- 태그/상태 변경 시 actor 추적 100%
- 요약 메일 실패 시 재시도 + 경고 동작 확인

---

## Phase 3.5. 인터랙티브 웹 UI (Supabase, 1~2주)

### 전제
- Supabase 프로젝트 준비 완료(`docs/develop/supabase-setup.md`), `DATABASE_URL` 및 anon key 확보

### 범위
- GitHub Pages 정적 프론트엔드(T-Client 유사 CSS, 차별화)
- Supabase Auth 기업 이메일 로그인
- 후보 조회/추천 태그/면접 일정·결과/노쇼/입사완료/블락(소프트 삭제) 웹 입력

### 구현 항목
- `db/supabase/` RLS 정책 + `auth.users`→`staff_profiles` 매핑 트리거 적용
- 프론트: Supabase JS 클라이언트(anon key), 세션/권한 처리
- 크롤러 파이프라인은 `DATABASE_URL`을 Supabase로 전환(코드 변경 없음)
- 임베디드 PGlite는 로컬 개발 기본값으로 유지

### 완료 기준
- 직원 로그인 후 태그/면접/삭제상태 웹에서 실시간 반영
- RLS로 비인가 쓰기 차단 확인
- 크롤러(Actions)와 웹 UI가 동일 데이터 공유 확인

---

## Phase 4. 멀티 사이트 확장 (지속)

### 범위
- 신규 사이트 connector 온보딩
- 설정 기반 운영 전환
- 사이트별 장애 격리

### 구현 항목
- `platform_configs`, `platform_routes`, `platform_health`
- connector interface 표준화:
  - `login(ctx)`
  - `crawlApplicants(ctx)`
  - `crawlTalentPool(ctx)`
  - `normalize(raw)`
  - `healthCheck(ctx)`

### 완료 기준
- 신규 사이트 1개 온보딩 시 공통 파이프라인 수정 없이 연결 가능

---

## 4) 로그인 이후 이동 설계 (핵심)

## 4.1 왜 별도 설계가 필요한가

- 로그인 직후 랜딩 화면이 고정되지 않을 수 있다.
- 사이트 A/B 테스트, UI 개편, 권한별 메뉴 차이로 경로가 달라진다.
- 따라서 "URL 하드코딩 1개"로는 운영이 불가능하다.

## 4.2 경로 설정 방식

사이트별 `Route Map` + `Selector Registry`를 별도 설정 파일로 관리한다.

예시 구조:

```yaml
platform: jobkorea
version: 2026-07-07
routes:
  home:
    url: "https://..."
    ready_selector: "[data-role=home-nav]"
  applicants_list:
    path_from_home:
      - action: click
        target: "nav_recruit"
      - action: click
        target: "menu_applicants"
    ready_selector: "table.applicant-list"
  talent_pool_list:
    path_from_home:
      - action: click
        target: "nav_talent"
      - action: click
        target: "menu_position_suggest"
    ready_selector: "div.talent-card"
selectors:
  nav_recruit: "a[href*='recruit']"
  menu_applicants: "a[href*='applicant']"
  nav_talent: "a[href*='talent']"
  menu_position_suggest: "a[href*='position']"
```

핵심 원칙:
- 경로(`routes`)와 셀렉터(`selectors`)를 코드에서 분리
- 사이트 변경 시 코드 수정 없이 설정 파일만 교체

## 4.3 이동 실행 엔진

공통 `Navigator` 모듈이 설정 파일을 읽어 단계별 이동을 수행한다.

기능:
- `goto(routeName)`
- action 지원: `click`, `type`, `wait`, `hover`, `scroll`, `iframe_switch`
- `ready_selector` 기반 성공 판정
- 실패 시 단계/셀렉터/스크린샷을 로그로 저장

## 4.4 수정/운영 방식

### 운영자가 수정 가능한 항목
- 메뉴 셀렉터
- 페이지 준비 셀렉터(`ready_selector`)
- 타임아웃/재시도 횟수
- 페이지네이션 전략

### 개발자가 수정해야 하는 항목
- 사이트가 SPA/iframe 구조로 크게 변경된 경우
- 로그인 플로우 자체 변경(2FA 단계 추가 등)
- 데이터 필드 구조 변경

## 4.5 경로 변경 대응 프로세스

1. 헬스체크 실패 감지 (`platform_health.fail_count_24h` 증가)
2. 최근 스크린샷/HTML snapshot 확인
3. Route Map/Selector Registry 수정
4. dry-run 실행
5. 통과 시 운영 반영

---

## 5) 페이지별 수집 시나리오 관리

사이트별로 최소 아래 시나리오를 유지한다.

- S1: 로그인 성공
- S2: 지원자 목록 진입
- S3: 지원자 상세 진입
- S4: 인재검색 목록 진입
- S5: 인재 상세 진입
- S6: 로그아웃/세션 만료 복구

각 시나리오별로 아래를 기록:
- 진입 경로
- 필수 selector
- 실패 코드
- 재시도 가능 여부

---

## 6) 운영 리스크와 대응

- 캡차 증가: 수동 승인 모드로 전환
- 계정 잠금: 예비 계정 fallback
- UI 대개편: selector version pinning + hotfix branch
- 메일 미발송: 08:10 재시도, 08:20 운영자 경고

---

## 7) 권장 일정(예시)

- 주차 1: Phase 0 완료
- 주차 2~3: Phase 1 완료
- 주차 4~5: Phase 2 완료
- 주차 6: Phase 3 완료
- 이후: Phase 4 상시 확장

---

## 8) 즉시 실행 To-Do

- `docs/develop` 하위에 사이트별 Route Map 파일 생성
- connector 공통 `Navigator` 인터페이스 먼저 확정
- 잡코리아/사람인 각각 dry-run 워크플로 생성
- 18:00/08:00 스케줄 크론을 UTC 기준으로 확정
