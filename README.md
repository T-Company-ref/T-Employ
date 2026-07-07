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
| Data | PostgreSQL (Supabase 호환) | 관계형 데이터 저장 |
| Automation | GitHub Actions (cron) | 18:00 수집 / 08:00 메일 |
| UI | GitHub Pages (예정) | 조회/추천/면접 관리 |

`DATABASE_URL` 만 교체하면 로컬 Postgres → Supabase/RDS 로 전환 가능하다.

## 빠른 시작 (로컬)

```bash
# 1) 환경변수 준비
cp .env.example .env   # Windows: copy .env.example .env

# 2) 로컬 Postgres 기동
docker compose up -d

# 3) 의존성 설치
npm install

# 4) 스키마 마이그레이션 + 시드
npm run db:migrate
npm run db:seed

# 5) Route Map 셀렉터 상태 확인 (Phase 0 검증)
npm run dev:check

# 6) 타입체크
npm run typecheck
```

## 주요 스크립트

| 명령 | 설명 |
|------|------|
| `npm run db:migrate` | 마이그레이션 적용 |
| `npm run db:status` | 마이그레이션 상태 확인 |
| `npm run db:seed` | 초기 시드 적용 |
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
src/db/              DB 클라이언트/마이그레이션/리포지토리
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
