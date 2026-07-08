# T-Employ

TBELL 채용 지원자/인재검색 통합 수집·관리 시스템.

- 매일 18:00 KST: 활성 플랫폼(잡코리아/사람인)에서 공고 지원자 및 인재검색 후보 순차 수집
- 다음날 08:00 KST: 전일 요약 메일 자동 발송
- 공고 지원자(Applicants)와 인재검색 후보(Talent Pool) 분리 운영
- 추천 태그(작성자 추적), 면접 일정/결과, 소프트 삭제 상태 관리

## 아키텍처

| 레이어 | 구성 | 역할 |
|--------|------|------|
| Collector | Playwright + Route Map | 로그인/네비게이션/수집 |
| Data | 임베디드 Postgres(PGlite) 기본 · 호스티드 Postgres 선택 | 관계형 데이터 저장 |
| Automation | GitHub Actions (cron) | 18:00 수집 / 08:00 메일 / 스냅샷 지속 |
| UI | GitHub Pages (예정) | 조회/추천/면접 관리 |

DB는 **계정·Docker·설치 없이** 임베디드 PostgreSQL(PGlite)로 바로 동작한다.
`DATABASE_URL=postgres://...` 를 설정하면 코드 수정 없이 호스티드 Postgres(Supabase/Neon/RDS)로 자동 전환된다.

웹(GitHub Pages)에서 직원이 로그인해 **추천 태그·면접 상태·삭제(블락)** 를 입력/수정하려면 정적 페이지가 쓰기할 백엔드가 필요하다. 이 인터랙티브 계층은 **Supabase**(DB+Auth+RLS)로 제공하며, 크롤러(Actions)와 웹 UI가 동일 Supabase를 공유한다. 준비 절차: `docs/develop/supabase-setup.md`. RLS/auth 매핑: `db/supabase/`.

## 빠른 시작 (로컬 · 설치 Zero)

```bash
# 1) 환경변수 준비
copy .env.example .env   # macOS/Linux: cp .env.example .env

# 2) 의존성 설치
npm install

# 3) 스키마 마이그레이션 + 시드 (임베디드 DB 자동 생성, Docker 불필요)
npm run db:migrate
npm run db:seed

# 4) Route Map 셀렉터 상태 확인 (Phase 0 검증)
npm run dev:check

# 5) 타입체크
npm run typecheck
```

데이터는 `data/pgdata` 파일에 저장된다(git 제외). 호스티드 DB를 쓰려면 `.env` 의 `DATABASE_URL` 주석을 풀면 된다.

## 주요 스크립트

| 명령 | 설명 |
|------|------|
| `npm run db:migrate` | 마이그레이션 적용 |
| `npm run db:status` | 마이그레이션 상태 확인 |
| `npm run db:seed` | 초기 시드 적용 |
| `npm run db:dump` | 임베디드 DB → 스냅샷(`data/pgdata.tar.gz`) |
| `npm run db:restore` | 스냅샷 → 임베디드 DB 복원 |
| `npm run db:supabase` | Supabase 전용 RLS/auth 정책 적용 (`db/supabase/*.sql`) |
| `npm run crawl:applicants [platform]` | 공고 지원자 수집 |
| `npm run crawl:talent [platform]` | 인재검색 후보 수집 |
| `npm run report:compose` | 전일 요약 생성 + 메일 큐 등록 |
| `npm run mail:send` | 요약 메일 발송 |
| `npm run dev:check` | Route Map 셀렉터 dry-run 검증 |

## 디렉토리 구조

```
config/routes/       사이트별 Route Map (YAML, 코드와 분리)
db/migrations/       스키마 마이그레이션 SQL
db/seed/             초기 데이터
src/config/          환경변수 로더
src/db/              DB 어댑터(PGlite/pg)/마이그레이션/시드/스냅샷 지속
src/crawler/         Navigator 엔진 + 커넥터
src/jobs/            배치 엔트리포인트 (수집/리포트/메일)
src/tools/           운영 도구 (route dry-run 등)
.github/workflows/   GitHub Actions (cron)
docs/develop/        기능명세/구현기획/Phase 계획
```

## 로그인/수집 원칙

- GitHub Pages 는 정적 UI, 로그인/수집은 Runner(권장: self-hosted)에서 수행.
- 로그인 성공 ≠ 수집 성공. 로그인 이후 네비게이션 경로가 핵심이며 `config/routes/*.yaml` 로 관리.
- 사이트 UI 변경 시 코드가 아닌 Route Map(YAML)만 수정.
- 세션은 재사용(`.sessions/`, git 제외)하고 만료 시 재로그인.

자세한 내용: `docs/develop/crawler-phase-plan.md`, `docs/develop/implementation-login-crawling.html`
