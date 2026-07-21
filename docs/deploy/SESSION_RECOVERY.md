# 세션 만료 감지 및 복구

## 전제

잡코리아 기업 세션은 비교적 오래 유지될 수 있지만, **유지 기간을 코드에 고정하지 않습니다.**  
만료·무효화는 실행 중 응답/화면으로 판단합니다.

## 만료 판단 기준

다음을 조합합니다 (`SessionExpiredError` / `classifyAuthError`).

| 신호 | 의미 |
|------|------|
| 로그인 페이지로 리다이렉트 | `login_page:...` |
| HTTP 401 / 403 | `HTTP_401` / `HTTP_403` |
| 세션 파일 없음·비어 있음 | `SESSION_MISSING` / `SESSION_EMPTY` |
| 로그인 실패·인증 화면 | `login_failed` 등 |
| (Playwright) 로그인 UI·필수 요소 부재 | 커넥터/로그인 결과 |

**인증 오류가 아닌 것:** timeout, `ECONNRESET`, DNS, 일시 fetch 실패 등 네트워크/일시 장애.  
이 경우 관리자 **세션 만료 메일**을 보내지 않고 일반 실패로 처리합니다.

## 자동 동작 (만료 시)

```text
작업 실행 → 세션 오류 감지 → 작업 중단
→ session_status=expired, session_error_notified 기록
→ 관리자 메일 1회 (이미 notified면 생략)
→ 사용자가 session-refresh 수동 실행
→ 성공 시 오류 플래그 초기화
```

폴링·크롤은 **자동으로 Playwright 재로그인하지 않습니다.**  
(Actions 시간·CAPTCHA 리스크를 줄이기 위함)

상태 파일: `.sessions/_auth-state.json` (세션 번들에 포함되어 `db-snapshot`에 함께 저장)

```text
status: active | expired
errorNotified: true | false
errorAt / errorReason / errorWorkflow
refreshedAt / lastOkAt
```

## 메일을 받은 뒤 할 일

1. 메일 본문의 **Run URL**로 실패 로그 확인  
2. GitHub → Actions → **`session-refresh`** → **Run workflow**  
   - platform: `jobkorea`  
   - notify_ok: `true` (성공 알림 원할 때)  
3. 성공 메일/로그 확인 후, 필요하면 `poll-applicants` / `pdf-applicants` 등을 다시 실행  
4. 복구 전까지 동일 세션 오류 메일은 **재발송되지 않음**

## session-refresh 수동 실행

UI: Actions → `session-refresh` → Run workflow  

CLI:

```bash
gh workflow run session-refresh.yml -f platform=jobkorea -f notify_ok=true
```

로컬:

```bash
npm run session:refresh -- jobkorea --notify-ok
```

성공 시: 새 storageState 저장 + `_auth-state` 초기화 + (옵션) 성공 메일.

## 갱신 실패 시 확인

- Secrets `JOBKOREA_USERNAME` / `JOBKOREA_PASSWORD` 올바른지  
- CAPTCHA·추가 인증·기업 보안 정책으로 headless 로그인 차단 여부  
- 로컬에서 `HEADLESS=false npm run dev:session -- jobkorea` 로 수동 로그인 가능 여부  
- `db-snapshot` 브랜치에 세션 번들이 푸시되는지 (workflow `db-save` 권한)  
- Actions 로그에 쿠키/비밀번호가 **출력되지 않는지** (출력되면 즉시 시크릿 로테이션)

CAPTCHA가 필요하면 Actions만으로는 복구가 안 될 수 있습니다. 로컬에서 세션을 만든 뒤 `sessions-bundle`을 운영 경로로 반영하거나, 담당자가 브라우저로 로그인 가능 상태를 확인하세요.

## 보안

- 세션 JSON·비밀번호·API 키를 **main에 커밋하지 않음**  
- Secrets만 사용  
- 세션은 `db-snapshot`의 `sessions-bundle.json` (현재 평문 JSON — `SESSION_ENC_KEY` 암호화는 미적용, 브랜치 접근 제한으로 보완)  
- 로그에 쿠키·비밀번호·키 출력 금지
