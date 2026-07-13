# Phase 3.5 — 인터랙티브 웹 UI (Supabase Auth + GitHub Pages)

## 무엇이 생겼나

| 경로 | 역할 |
|------|------|
| `web/` | 정적 SPA (로그인 / 지원자 / 인재검색 / 태그·면접·상태·블락) |
| `db/supabase/0002_web_write_policies.sql` | 웹 쓰기 RLS + 태그 감사 트리거 |
| `.github/workflows/deploy-web.yml` | GitHub Pages 배포 |

크롤러(Actions/로컬)와 웹은 **같은 Supabase DB**를 봅니다.

---

## 1) Supabase 준비 (1회)

### Auth
1. Supabase → **Authentication → Providers → Email** 활성화
2. **Authentication → Users → Add user** 로 직원 추가  
   예: `yj.kim@tbell.co.kr` + 비밀번호
3. (선택) 이메일 도메인 제한은 Auth Hook/정책으로 추후 강화

### RLS / 시드
Actions → **`db-setup-supabase`** → Run workflow (seed 체크)

또는 SQL Editor에서 순서대로:
1. `db/migrations/*.sql` (이미 적용됐으면 스킵)
2. `db/supabase/0001_rls_auth.sql`
3. `db/supabase/0002_web_write_policies.sql`
4. `db/seed/seed.sql` ( `yj.kim@tbell.co.kr` staff 포함 )

신규 Auth 사용자는 트리거로 `staff_profiles`에 연결됩니다.  
기존 Auth 사용자면 SQL로 수동 연결:

```sql
UPDATE staff_profiles s
SET auth_user_id = u.id
FROM auth.users u
WHERE s.email = u.email AND s.auth_user_id IS NULL;
```

### Secrets (웹 + Actions)
| Secret | 용도 |
|--------|------|
| `SUPABASE_URL` | `https://koxsezeotvylkeqeixnb.supabase.co` |
| `SUPABASE_ANON_KEY` | anon public key |
| `DATABASE_URL` | Session pooler (크롤러/마이그레이션) |

---

## 2) 로컬에서 보기

```bash
# 1) config
copy web\config.example.js web\config.js
# config.js 에 supabaseUrl / supabaseAnonKey 입력

# 2) 정적 서버 (예)
npx --yes serve web -p 5173
```

브라우저: http://localhost:5173  
로그인: Supabase에 만든 이메일/비밀번호

---

## 3) GitHub Pages 배포

1. 레포 **Settings → Pages → Source = GitHub Actions**
2. Secrets에 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 등록
3. Actions → **deploy-web** → Run workflow  
   (또는 `web/**` push 시 자동)

배포 URL 예: `https://<org>.github.io/T-Employ/`

> 서브패스 배포 시에도 상대경로(`./`)를 쓰므로 추가 base 설정 불필요.

---

## 4) 화면에서 할 수 있는 것

- 지원자 목록 / 인재검색 목록 (검색·플랫폼 필터)
- 상세: 추천 태그 추가·제거 (작성자 추적 + audit 트리거)
- 면접 일정 등록 / 결과(pass·fail·no_show·canceled)
- 단계 변경 / 블락(소프트 삭제, `is_active=false`)

물리 삭제는 UI에 없습니다.

---

## 5) 안 보일 때 체크

| 증상 | 확인 |
|------|------|
| 설정 없음 경고 | `config.js` 또는 Pages Secrets |
| 로그인 실패 | Auth Users에 계정 있는지 |
| 목록 비어 있음 | Table Editor에 크롤 데이터 / RLS 적용 여부 |
| 태그 저장 실패 | `staff_profiles.auth_user_id` 연결, `0002` RLS |
| “권한 연결 필요” | Auth 이메일 = staff.email, 트리거/수동 UPDATE |
