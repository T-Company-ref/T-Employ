# GitHub Actions 기반 배치 운영

**현재 우선 운영 방식:** GitHub Actions 예약·수동 배치  
**향후 선택:** Oracle Cloud / VM 상시 서버 (`docs/ops/oracle-deploy.md`, `deploy/oracle/`)

Private 저장소 기준, Actions 무료 시간(약 2,000분/월) 안에서 돌리도록 **역할 분리 + Playwright 최소화** 합니다.

## Workflow 구조

| Workflow 파일 | 역할 | Playwright | 주기 (KST) |
|---------------|------|------------|------------|
| `poll-applicants.yml` | 지원자 목록 경량 폴링 (HTTP+HTML) | 없음 | 평일 08:17~11:17, 13:17~19:17 (12:17 생략) |
| `crawl-talent.yml` | 인재 목록 수집 | Chromium | 평일 07:07 |
| `pdf-applicants.yml` | 누락 지원자 PDF만 생성 | Chromium | 평일 07:27 + 수동 |
| `mail-morning-digest.yml` | 아침 요약 메일 (DB 기준) | 없음 | 평일 07:37 |
| `session-refresh.yml` | 로그인 세션 재발급 | Chromium | 평일 06:47 · 13:17 + 수동 |

레거시(수동만): `crawl-applicants.yml`, `crawl-talent-pool.yml`, `refresh-session.yml`

공통 concurrency:

```yaml
concurrency:
  group: t-employ-db-write
  cancel-in-progress: false
```

세션·DB 쓰기가 겹치지 않도록 순차 실행됩니다.

## UTC ↔ KST cron

GitHub cron은 **UTC**입니다. (한국 표준시 = UTC+9)

| 작업 | KST | UTC cron |
|------|-----|----------|
| session-refresh | 평일 06:47 | `47 21 * * 0-4` |
| session-refresh | 평일 13:17 | `17 4 * * 1-5` |
| crawl-talent | 평일 07:07 | `7 22 * * 0-4` |
| pdf-applicants | 평일 07:27 | `27 22 * * 0-4` |
| mail-morning-digest | 평일 07:37 | `37 22 * * 0-4` |
| poll-applicants | 평일 08:17 | `17 23 * * 0-4` |
| poll-applicants | 평일 09:17~11:17 | `17 0-2 * * 1-5` |
| poll-applicants | 평일 13:17~19:17 | `17 4-10 * * 1-5` |
| session-refresh | 평일 12:47 | `47 3 * * 1-5` |

## 사용량 줄이는 설계

- `poll-applicants`: `npm ci`만, Playwright/Chromium **설치 금지**
- Chromium은 `crawl-talent` / `pdf-applicants` / `session-refresh` 에만 설치 (+ 브라우저 캐시)
- Node `cache: npm`
- 신규 지원자·누락 PDF·다이제스트 대상 없으면 조기 종료
- 세션 정기 갱신은 평일 **2회** (06:47 / 13:17 KST) — 인재 크롤·폴링 전에 세션 확보
- 인증 오류 메일은 복구 전까지 **1회만**
- `timeout-minutes` 지정, 무한 재시도 없음

대략 월 사용량 가이드(캐시 hit 가정):

- poll ~12회/일 × ~2분 ≈ 월 ~500분
- talent/pdf/digest 각 1회/평일 × 수~십여 분 ≈ 월 ~300~600분
- session 평일 2회 ≈ 월 ~100~200분  
→ 합계 2,000분 이내를 목표로 설계 (session 2회/일로 증가)

## GitHub Secrets

Repository → Settings → Secrets and variables → Actions → **Secrets**

| Secret | 용도 |
|--------|------|
| `JOBKOREA_USERNAME` | 기업회원 로그인 ID |
| `JOBKOREA_PASSWORD` | 로그인 비밀번호 |
| `GMAIL_USER` | Gmail SMTP 계정 (`tbell.wr@gmail.com`) |
| `GMAIL_APP_PASSWORD` | Google 앱 비밀번호 |
| `MAIL_FROM` | 발신 표시 (예: `T-Employ <tbell.wr@gmail.com>`) |
| `DATABASE_URL` | Supabase/Postgres 연결 문자열 |
| `SUPABASE_URL` | PDF 스토리지 등 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 측 Supabase |

Repository → Settings → Secrets and variables → Actions → **Variables**

| Variable | 값 | 용도 |
|----------|-----|------|
| `ACTION_NOTIFY_EMAIL` | `yj.kim@tbell.co.kr` | 운영·인증 오류 알림 수신 |

미설정 시 코드/워크플로 기본값은 `yj.kim@tbell.co.kr`입니다.

발신 예: `MAIL_FROM=T-Employ <tbell.wr@gmail.com>`  
`.env`나 workflow YAML에 실제 Secret 값을 넣지 마세요.

등록 예:

```bash
gh secret set GMAIL_USER
gh secret set GMAIL_APP_PASSWORD
gh secret set MAIL_FROM
gh variable set ACTION_NOTIFY_EMAIL --body "yj.kim@tbell.co.kr"
```

## 세션 저장

- 런타임: `.sessions/*.json` (+ `_auth-state.json` 인증 오류 플래그)
- Actions: `db-load` / `db-save` 가 `db-snapshot` 브랜치의 `sessions-bundle.json` 복원·저장
- hosted Postgres여도 **세션 번들은 항상** 저장/복원

민감 세션·비밀번호를 main 브랜치에 커밋하지 마세요.

## 수동 실행

Actions → 해당 workflow → **Run workflow**

| Workflow | 유용한 입력 |
|----------|-------------|
| poll-applicants | `limit`, `dry_run` |
| crawl-talent | `platform`, `limit` |
| pdf-applicants | `limit`, `ref`, `repair` |
| mail-morning-digest | `force`, `talents_only` |
| session-refresh | `platform`, `notify_ok` |

로컬 대응:

```bash
npm run poll:applicants -- --limit 10
npm run crawl:talent -- jobkorea
npm run pdf:applicants -- --limit 5
npm run mail:morning-digest -- --force --no-browser
npm run session:refresh -- jobkorea --notify-ok
```

## 관련 문서

- [SESSION_RECOVERY.md](./SESSION_RECOVERY.md)
- [OPERATIONS.md](./OPERATIONS.md)
- [../ops/schedule.md](../ops/schedule.md)
