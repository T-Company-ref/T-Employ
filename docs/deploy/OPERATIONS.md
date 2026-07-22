# 일상 운영 절차 (GitHub Actions)

현재 기본 경로: **Actions 배치**. Oracle VM은 선택 사항입니다.

상세 스케줄·Secrets: [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md)  
세션 복구: [SESSION_RECOVERY.md](./SESSION_RECOVERY.md)  
직원 역할·알림: [ROLES.md](./ROLES.md)

## 일상 흐름 (평일)

```text
06:47  session-refresh
07:07  crawl-talent
07:27  pdf-applicants (누락분만)
07:37  mail-morning-digest
08:17~11:17  poll-applicants (매시)
12:47        session-refresh (오후)
13:17~19:17  poll-applicants (매시, 12:17 생략)
13:17  session-refresh (오후 재발급)
```

신규 지원자 실시간 메일·다이제스트 규칙은 기존 `notifySchedule` / 메일 모듈을 따릅니다.

## 지원자 수집 실패 확인

1. Actions → `poll-applicants` 최근 run (빨간 X / 로그)  
2. 메일에 세션 만료가 왔으면 → [SESSION_RECOVERY.md](./SESSION_RECOVERY.md)  
3. 네트워크/일시 오류면 다음 정각(17분) 재시도로 회복되는지 확인  
4. Supabase/DB: 최근 `crawl_jobs` / 지원자 `created_at`  
5. 로컬: `npm run poll:applicants -- --limit 5 --dry-run`

## PDF 재생성

- 누락분만: Actions → `pdf-applicants` → Run (`limit` 조절)  
- 특정 건: `ref` 에 external_ref 입력  
- 깨진 PDF 재수집: `repair=true`  
- 로컬: `npm run pdf:applicants -- --limit 5 --ref=...`

이미 PDF가 있으면 기본적으로 건너뜁니다 (전체 재생성 금지).

## 메일 재발송

- 아침 다이제스트: `mail-morning-digest` → `force=true` (필요 시 `talents_only=true`)  
- 로컬: `npm run mail:morning-digest -- --force --no-browser`  
- 신규 내용이 없으면 발송을 생략합니다.
- 발송: **Gmail SMTP** (`GMAIL_USER` + `GMAIL_APP_PASSWORD` + `MAIL_FROM`)  
- 운영 알림 수신: Repository Variable `ACTION_NOTIFY_EMAIL` (기본 `yj.kim@tbell.co.kr`)

## 필수 설정 요약

```text
Secrets:
- JOBKOREA_USERNAME
- JOBKOREA_PASSWORD
- GMAIL_USER
- GMAIL_APP_PASSWORD
- MAIL_FROM
- DATABASE_URL
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Repository Variable:
- ACTION_NOTIFY_EMAIL=yj.kim@tbell.co.kr
```

## 세션 복구

`session-refresh` 수동 실행. 절차는 [SESSION_RECOVERY.md](./SESSION_RECOVERY.md).

## DB / 상태 복구

| 데이터 | 위치 |
|--------|------|
| 지원자·인재·문서 메타 | `DATABASE_URL` (Supabase/Postgres) 우선 |
| Playwright 세션 + `_auth-state` | `db-snapshot` 브랜치 `sessions-bundle.json` |
| (PGlite 사용 시) DB 스냅샷 | `db-snapshot` 의 `pgdata.tar.gz` |

복구:

```bash
# Actions 실패 후 세션만 의진 경우
# → session-refresh 성공 후 db-save 확인

# 로컬에서 번들 확인
git fetch origin db-snapshot
git show db-snapshot:sessions-bundle.json | head
```

GitHub Actions **artifact를 DB처럼 쓰지 않습니다.**

## Actions 사용량 확인

GitHub → Organization/User → Settings → Billing → Actions  
또는 repo Insights / Actions 탭에서 실행 시간 확인.

목표: 월 **2,000분** 이내. poll에 Playwright를 넣지 말고, PDF·talent 빈도를 올리지 마세요.

## Oracle (선택)

상시 서버가 필요할 때만 `docs/ops/oracle-deploy.md` / `deploy/oracle/` 사용.  
Actions와 **동일 cron을 동시에 켜면 이중 수집·이중 메일**이 납니다. 한쪽만 운영하세요.
