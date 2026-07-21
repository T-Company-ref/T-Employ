# TBELL Employ — 역할 분리 & 스케줄

**현재 우선 운영:** GitHub Actions 배치 — [`docs/deploy/GITHUB_ACTIONS.md`](../deploy/GITHUB_ACTIONS.md)  
**향후 선택:** Oracle VM 상시 서버 — [`oracle-deploy.md`](./oracle-deploy.md)

목록 폴링은 **가벼움(fetch)**, 브라우저는 **세션·PDF·인재**만 담당합니다.

## 역할 경계

| Job | Workflow / npm | 기술 | 주기 (KST) |
|-----|----------------|------|------------|
| 세션 갱신 | `session-refresh` / `session:refresh` | Playwright | **매월 1일 06:30** + 수동 |
| 인재 수집 | `crawl-talent` / `crawl:talent` | Playwright | 평일 **07:07** |
| 지원자 PDF | `pdf-applicants` / `pdf:applicants` | Playwright 인쇄 | 평일 **07:27** + 수동 (누락분만) |
| 아침 다이제스트 | `mail-morning-digest` / `mail:morning-digest` | DB + SMTP (브라우저 없음) | 평일 **07:37** |
| 지원자 목록 | `poll-applicants` / `poll:applicants` | **fetch + HTML** | 평일 **08:17~19:17** 매시 |
| 헬스체크 | `ops:health` | DB + heartbeat | 필요 시 |
| 인재 PDF | `pdf:talents` | Playwright | 필요 시 |

- `crawl:applicants` = 구형 Playwright 풀 크롤 (비상용). 일상은 `poll:applicants`.
- 세션 만료 시 **자동 refresh 없음** → 관리자 메일 1회 → `session-refresh` 수동.

## 환경

```bash
HEADLESS=true
AUTO_CRAWL_ENABLED=true   # Actions schedule / Oracle 타이머
CRAWL_MAX_ITEMS=50
PDF_MAX_ITEMS=15
DIGEST_SKIP_BROWSER=true  # 다이제스트에서 Playwright 생략
```

세션: `.sessions/jobkorea_tbell-corp.json`  
상태: `.sessions/_auth-state.json`  
만료 → 작업 중단 + 인증 메일 → `session:refresh`.

## 로컬 스모크

```bash
npm run session:refresh -- jobkorea
npm run poll:applicants -- --limit 10
npm run pdf:applicants -- --limit 3
npm run mail:morning-digest -- --force --no-browser
```

## Oracle (선택, Actions와 동시 가동 금지)

```bash
sudo bash deploy/oracle/bootstrap.sh
# .env 편집 후
sudo bash deploy/oracle/install-timers.sh
sudo bash deploy/oracle/smoke-check.sh
```
