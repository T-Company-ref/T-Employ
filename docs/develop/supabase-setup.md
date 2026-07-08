# Supabase 준비 가이드 (사용자 1회 작업 · 약 5분)

웹(GitHub Pages)에서 직원이 로그인해 추천 태그·면접 상태·삭제(블락)를 입력/수정하려면 호스티드 DB가 필요하다.
계정 생성과 키 발급은 **소유 계정에서만** 가능하므로 아래 5단계만 직접 진행하면 된다. 이후 스키마·RLS·연동·배포는 전담 처리한다.

---

## 1. 프로젝트 생성 (2분)
1. https://supabase.com 접속 → **GitHub로 로그인** (클릭 한 번)
2. **New project** 클릭
3. 입력:
   - Name: `t-employ`
   - Database Password: 강한 비밀번호 생성 후 **따로 저장** (연결 문자열에 쓰임)
   - Region: `Northeast Asia (Seoul)` 권장
4. **Create new project** → 프로비저닝 1~2분 대기

## 2. 연결 문자열(DATABASE_URL) 복사 (1분)

> ⚠️ **DATABASE_URL 은 `https://...` 주소가 아니다.** `https://[REF].supabase.co` 는 API 주소(=`SUPABASE_URL`)이며,
> `DATABASE_URL` 은 반드시 `postgresql://...` 로 시작하는 Postgres 접속 문자열이다.

1. 상단 **Connect** 버튼 (또는 **Project Settings → Database → Connection string**)
2. GitHub Actions 러너는 IPv4 환경이 많으므로 **Session pooler** 를 선택 (IPv4 호환, 마이그레이션 안전)
3. 표시된 문자열 복사 (형식):
   ```
   postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
   ```
   - `[YOUR-PASSWORD]` 를 1단계에서 저장한 DB 비밀번호로 치환
   - `[REGION]` 은 대시보드에 표시된 실제 값(서울은 `ap-northeast-2`)을 그대로 사용
   - 참고: 직접 연결(`db.[REF].supabase.co:5432`)은 IPv6 전용이라 GitHub Actions 에서 실패할 수 있음 → **Session pooler 권장**

## 3. API 키 복사 (1분)
1. **Project Settings** → **API**
2. 아래 두 값 복사:
   - **Project URL** (예: `https://[PROJECT-REF].supabase.co`)
   - **anon public** key (브라우저에서 사용, 공개되어도 되는 키)
   - **service_role** key (서버/Actions 전용, **절대 공개 금지**)

## 4. GitHub Secrets 등록 (1분)
레포 → **Settings → Secrets and variables → Actions → New repository secret** 로 아래 등록:

| Secret 이름 | 값 |
|-------------|-----|
| `DATABASE_URL` | 2단계 연결 문자열 |
| `SUPABASE_URL` | 3단계 Project URL |
| `SUPABASE_ANON_KEY` | 3단계 anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | 3단계 service_role key |

> `DATABASE_URL` 이 등록되면 GitHub Actions 는 자동으로 임베디드 DB 대신 **Supabase** 를 사용한다(코드 변경 없음).

## 5. 스키마 적용 (버튼 실행)
Secrets 등록이 끝나면 비밀번호를 공유할 필요 없이 GitHub 에서 버튼으로 스키마를 반영한다.

1. 레포 **Actions** 탭 → 왼쪽 **db-setup-supabase** 선택
2. **Run workflow** 클릭 (seed 체크 유지)
3. 아래 단계가 실행됨:
   - `db:migrate` — `db/migrations/*` 공통 스키마
   - `db:seed` — 초기 시드(선택)
   - `db:supabase` — `db/supabase/*` (RLS + auth→staff_profiles 매핑)

> 워크플로가 `DATABASE_URL 이 postgres:// 가 아닙니다` 로 실패하면 2단계의 접속 문자열이 잘못 등록된 것이다(https 주소를 넣은 경우). Session pooler URL 로 교체 후 재실행.

이후 프론트엔드(로그인/태그/면접/삭제상태)를 Supabase 에 연결하여 배포하는 작업이 이어진다.

---

## 참고: 키의 위치와 노출 원칙
| 키 | 저장 위치 | 공개 여부 |
|----|-----------|-----------|
| `DATABASE_URL` | GitHub Secrets / 로컬 `.env` | 비공개 |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Secrets (Actions 전용) | **비공개(중요)** |
| `SUPABASE_URL` | 프론트 설정 | 공개 가능 |
| `SUPABASE_ANON_KEY` | 프론트 설정 | 공개 가능(RLS로 보호) |

로컬에서 Supabase 없이 개발할 때는 `.env` 의 `DATABASE_URL` 을 비워두면 임베디드 PGlite 가 자동 사용된다.
