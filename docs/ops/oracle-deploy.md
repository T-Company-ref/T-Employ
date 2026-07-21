# Oracle Always Free 배포 가이드 (Phase C · 선택)

> **현재 우선 운영:** GitHub Actions 배치 — [`docs/deploy/GITHUB_ACTIONS.md`](../deploy/GITHUB_ACTIONS.md)  
> 이 문서는 **향후 상시 서버**가 필요할 때 쓰는 선택 경로입니다. Actions와 **동시에 스케줄을 켜지 마세요.**

Cursor/에이전트가 서버 세팅까지 수행한다. **사용자는 Oracle 콘솔 로그인 + VM 생성만** 하면 된다.

## 사용자가 할 일 (로그인·VM만)

1. [Oracle Cloud](https://cloud.oracle.com/) 로그인  
2. **Compute → Instances → Create**  
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM)  
   - OCPU: **1**, Memory: **6 GB** (Always Free: 합계 2 OCPU / 12 GB 이내)  
   - Image: **Ubuntu 22.04** (aarch64)  
   - Boot volume: 50 GB 이상  
   - SSH key: 본인 공개키 등록  
3. Public IP 확인 후 에이전트에 전달:
   - `ssh ubuntu@<PUBLIC_IP>`
   - (선택) private key 경로 / repo URL

> Micro (E2.1.Micro 1GB) 는 Playwright에 부적합 — **사용하지 말 것**.

## 에이전트가 할 일 (SSH 이후)

```bash
# 1) 코드 배치 (예시: git)
export T_EMPLOY_REPO='https://github.com/<ORG>/<REPO>.git'
export T_EMPLOY_BRANCH=main
export T_EMPLOY_USER=ubuntu
sudo -E bash -c 'curl -fsSL ... '   # 또는 로컬에서 scp 후
# repo가 이미 /home/ubuntu/tbell_employ 에 있다면:
cd /path/to/repo
sudo T_EMPLOY_USER=ubuntu bash deploy/oracle/bootstrap.sh

# 2) 시크릿
sudo nano /opt/t-employ/.env
# AUTO_CRAWL_ENABLED=true 필수

# 3) 세션
sudo -u ubuntu bash -lc 'cd /opt/t-employ && npm run session:refresh -- jobkorea'

# 4) 타이머
sudo bash /opt/t-employ/deploy/oracle/install-timers.sh

# 5) 스모크
sudo bash /opt/t-employ/deploy/oracle/smoke-check.sh
```

## 타이머 목록 (Asia/Seoul)

| Timer | When | Job |
|-------|------|-----|
| `t-employ-session.timer` | 평일 07:17 · 13:17 | `session:refresh` |
| `t-employ-talent.timer` | 매일 07:00 | `crawl:talent` |
| `t-employ-pdf.timer` | 매일 07:20 | `pdf:applicants` |
| `t-employ-digest.timer` | 월~금 07:30 | `mail:morning-digest` |
| `t-employ-poll.timer` | 매 15분 | `poll:applicants` |
| `t-employ-health.timer` | 6시간마다 | `ops:health` |

로그: `/var/log/t-employ/`  
하트비트: `data/poll-heartbeat.json`  
헬스 알림 쿨다운: `data/health-alert-state.json`  

```bash
systemctl list-timers 't-employ-*'
journalctl -u t-employ-poll.service -n 50
tail -f /var/log/t-employ/poll_applicants-$(date +%Y%m%d).log
```

## 산출물

```
deploy/oracle/
  bootstrap.sh          # Node·deps·clone/sync·playwright·units 설치
  install-timers.sh     # enable --now
  smoke-check.sh
  run-job.sh            # → /usr/local/bin/t-employ-run
  env.example
  systemd/*.service
  systemd/*.timer
```

## Phase D로 넘기는 것

완료됨 — 세션 자동 재시도, `ops:health`, Actions cron 금지.  
다음 목록: [`next-steps.md`](./next-steps.md)
