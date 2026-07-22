# T-Employ (Pages)

TBELL 채용 **GitHub Pages 정적 UI만** 담는 공개 레포.

- **GitHub:** https://github.com/T-Company-ref/T-Employ.git
- **포함:** `web/` (HTML/CSS/JS) + `deploy-web` Actions
- **미포함:** 크롤러 · DB 스키마 · SMTP · 서버 코드 · Secrets 원문

브라우저가 Supabase(Auth+RLS)에 직접 붙는다.  
`web/config.js`는 배포 시 Actions가 Secrets로 생성한다 (`config.example.js`만 커밋).

## 로컬

```bash
copy web\config.example.js web\config.js
# SUPABASE_URL / ANON_KEY 입력 후 정적 서버로 web/ 서빙
npx --yes serve web -p 5173
```

## 배포

`.github/workflows/deploy-web.yml` — Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## 관련 (비공개 권장)

| 폴더 | 역할 |
|------|------|
| `JOBKOREA-Crawling` | 잡코리아 수집 |
| `T-Employ-db` | 스키마 / RLS |
| `T-Employ-mail` | 메일 발송 |
