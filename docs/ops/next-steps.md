# 다음에 할 일 (Actions 배치 기준)

A 경량 폴링 · B 역할 분리 · Actions 워크플로 · D 세션 알림까지 **코드/워크플로는 준비됨**.  
남은 건 **Secrets 등록·첫 session-refresh·관찰**과 선택 고도화다.

## 지금 바로 (필수)

1. GitHub Secrets 등록 — [`docs/deploy/GITHUB_ACTIONS.md`](../deploy/GITHUB_ACTIONS.md)  
2. Actions → **`session-refresh`** 수동 1회 (세션 번들 생성)  
3. `poll-applicants` dry_run 또는 limit 소량 수동 실행  
4. 1~2일 관찰 — 스케줄 run / 메일 / 세션 만료 알림

## 단기 (권장)

| 우선 | 항목 | 설명 |
|------|------|------|
| 1 | Actions 분 사용량 확인 | poll·PDF 한도 튜닝 |
| 2 | `SESSION_ENC_KEY` 암호화 | 세션 번들 평문 → 암호화 (미구현) |
| 3 | 인재 PDF 스케줄 | `pdf:talents` 필요 시 별도 workflow |
| 4 | 헬스체크 Actions | `ops:health` 주기 실행 여부 |

## 중기 (선택)

| 항목 | 설명 |
|------|------|
| Oracle VM | 상시 서버 필요 시 [`oracle-deploy.md`](./oracle-deploy.md) |
| HTML 파서 회귀 테스트 | 잡코리아 UI 변경 대비 |
| 사람인 연동 | 2FA 세션 후 |
| 알림 채널 | Slack/Teams |

## 하지 말 것

- poll workflow에 Playwright/Chromium 설치  
- Actions와 Oracle timer **동시** 가동  
- E2 Micro 1GB 에 Playwright  
- JobKorea 지원자 Open API 기대 (없음 확인됨)

## 한 줄 다음 액션

> Secrets 넣고 `session-refresh` 한 번 돌린 뒤, 평일 스케줄을 관찰하면 됩니다.
