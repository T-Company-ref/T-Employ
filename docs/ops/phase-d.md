# Phase D — 운영 안정화

## 구현됨 (Actions 우선 경로)

| 항목 | 내용 |
|------|------|
| 세션 만료 감지 | HTTP 401/403, login_page, SESSION_* 등 (`classifyAuthError`) |
| 인증 오류 메일 | 최초 1회만 (`_auth-state.json` + `handleAuthFailure`) |
| 자동 refresh 없음 | 사용자가 Actions `session-refresh` 수동 실행 |
| 하트비트 | 성공 시 `data/poll-heartbeat.json` |
| 헬스체크 | `npm run ops:health` — 24h 무소식 시 메일 |
| Actions 역할 분리 | poll / talent / pdf / digest / session-refresh |
| concurrency | `t-employ-db-write`, `cancel-in-progress: false` |

## Oracle 경로 (선택)

| 항목 | 내용 |
|------|------|
| Oracle timer | `t-employ-health.timer` 등 (`deploy/oracle/`) |
| Actions와 병행 금지 | 이중 수집·메일 방지 |

## 사용

```bash
npm run ops:health
npm run ops:health -- --hours 24 --force
```

문서: [`docs/deploy/OPERATIONS.md`](../deploy/OPERATIONS.md)
