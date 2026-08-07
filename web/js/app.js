import { configReady, createClient } from "./client.js?v=20260807f";
import * as api from "./api.js?v=20260807f";
import { Icon } from "./icons.js?v=20260807f";
import {
  stageLabel,
  proposalLabel,
  platformLabel,
  platformIcon,
  label,
  roleLabel,
  staffCaps,
  STAGE_LABELS,
  TAG_LABELS,
  POSTING_STATUS_SIDE,
  MEETING_LABELS,
  INTERVIEW_RESULT_LABELS,
  PROPOSAL_STATUS_LABELS,
} from "./labels.js?v=20260807f";
import {
  JOB_CATEGORIES,
  resolveTalentCategory,
  categoryShort,
} from "./categories.js?v=20260807f";

const appEl = document.getElementById("app");

const TAB_HASH = {
  dashboard: "#/dashboard",
  postings: "#/postings",
  applicants: "#/applicants",
  talent: "#/talent",
};

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let sb = null;
let staff = null;
let tab = "dashboard"; // dashboard | postings | applicants | talent
let rows = [];
let selected = null;
let filterQ = "";
let filterPlatform = "";
let filterCategory = "all"; // talent side tabs
/** @type {'open'|'closed'} 공고·지원자 사이드 기본: 진행 중 */
let filterPostingStatus = "open";
/** 공고·지원자: 플랫폼 필터 (빈 문자열 = 전체) */
let filterPlatformSide = "";
/** 지원자 탭: 특정 공고만 (빈 문자열 = 해당 상태 전체) */
let filterApplicantPostingId = "";
/** 지원자: 이력서/첨부/단계/대학 */
let filterHasResume = ""; // "" | "yes" | "no"
let filterHasAttach = "";
let filterStage = "";
let filterSchool = "";
/** 인재검색: 제안 상태 */
let filterProposal = "";
/** @type {Map<string, { resume: boolean, attach: boolean }>} */
let appDocFlags = new Map();
/** 사이드 섹션 접힘 */
let sideFoldPlat = false;
let sideFoldPost = false;
/** 상세 필터 패널 */
let filterAdvancedOpen = false;
/** 지원자 사이드용 공고 캐시 */
let postingNavRows = [];
/** 공고 선택 시 하단 지원자 */
let selectedPostingApps = [];
let listPage = 1;
const PAGE_SIZE = 10;
let toastTimer = null;
let dashboardStats = null;
let paneWheelBound = false;

/** 탭 데이터 캐시 — 헤더 이동 시 재조회 생략 */
const tabCache = {
  dashboard: /** @type {{ stats: any, at: number } | null} */ (null),
  postings: /** @type {{ rows: any[], q: string, at: number } | null} */ (null),
  applicants: /** @type {{ rows: any[], postingNavRows: any[], flags: Map<string, any>, q: string, at: number } | null} */ (null),
  talent: /** @type {{ rows: any[], q: string, platform: string, at: number } | null} */ (null),
};
const CACHE_TTL_MS = 90_000;

function cacheFresh(entry) {
  return Boolean(entry && Date.now() - entry.at < CACHE_TTL_MS);
}

function invalidateTabCache(which) {
  if (!which || which === "all") {
    tabCache.dashboard = null;
    tabCache.postings = null;
    tabCache.applicants = null;
    tabCache.talent = null;
    return;
  }
  tabCache[which] = null;
}

function resetListFilters({ keepPostingId = false, keepPostingStatus = false } = {}) {
  filterQ = "";
  filterPlatform = "";
  filterPlatformSide = "";
  filterCategory = "all";
  if (!keepPostingStatus) filterPostingStatus = "open";
  if (!keepPostingId) filterApplicantPostingId = "";
  filterHasResume = "";
  filterHasAttach = "";
  filterStage = "";
  filterSchool = "";
  filterProposal = "";
  sideFoldPlat = false;
  sideFoldPost = false;
  filterAdvancedOpen = false;
  listPage = 1;
}

function tabFromHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "").split(/[/?#]/)[0];
  if (raw === "postings" || raw === "applicants" || raw === "talent" || raw === "dashboard") {
    return raw;
  }
  return null;
}

function syncHashFromTab() {
  const want = TAB_HASH[tab] || TAB_HASH.dashboard;
  if (location.hash !== want) {
    history.replaceState(null, "", want);
  }
}

function docFlagsFor(appId) {
  return appDocFlags.get(appId) || { resume: false, attach: false };
}

function postingPeriodEndMs(p) {
  const end = p?.meta?.periodEnd;
  if (end) {
    const t = new Date(`${end}T23:59:59+09:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const period = String(p?.meta?.period || "");
  const matches = [...period.matchAll(/(\d{4})\.(\d{2})\.(\d{2})/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const t = new Date(`${last[1]}-${last[2]}-${last[3]}T23:59:59+09:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

function isPostingClosed(p) {
  if (!p) return false;
  if (p.closed_at) return true;
  if (String(p.meta?.pubType || "") === "2") return true;
  const s = String(p.meta?.status || "");
  if (/마감|종료|closed|완료|접수마감/i.test(s)) return true;
  const endMs = postingPeriodEndMs(p);
  if (endMs != null && endMs < Date.now()) return true;
  return false;
}

function fmtResumeLastModified(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fmtDate(iso);
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return `${m[1]}.${m[2]}.${m[3]}`;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 (${wd})`;
}

function normalizeLoginId(raw) {
  const s = String(raw || "").trim();
  if (!s) return s;
  if (s.includes("@")) return s;
  return `${s}@tbell.co.kr`;
}

function caps() {
  return staffCaps(staff?.role);
}

function staffNick(s) {
  return s?.nickname || s?.display_name || "";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function isNew(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000;
}

function toast(msg, isError = false) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast${isError ? " error" : ""}`;
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

function renderChips(items, cls = "skill-chip") {
  if (!items?.length) return "";
  return `<div class="${cls === "skill-chip" ? "skill-row" : "badge-row"}">${items
    .map((t) => `<span class="${cls}">${esc(t)}</span>`)
    .join("")}</div>`;
}

function resumeDoc(docs) {
  return (
    docs?.find((d) => d.doc_type === "resume" && d.file_url && !d.file_url.startsWith("file://")) ||
    docs?.find((d) => d.file_url && !d.file_url.startsWith("file://") && d.doc_type !== "portfolio" && d.doc_type !== "other")
  );
}

function attachmentDocs(docs) {
  return (docs || []).filter(
    (d) =>
      (d.doc_type === "portfolio" || d.doc_type === "other") &&
      d.file_url &&
      !d.file_url.startsWith("file://"),
  );
}

function renderDocuments(docs) {
  const resume = resumeDoc(docs);
  const atts = attachmentDocs(docs);
  const resumeVal = resume
    ? `<a class="doc-link" href="${esc(resume.file_url)}" target="_blank" rel="noopener">${esc(
        resume.source_name || "이력서 열기",
      )} ${Icon.external({ size: 12, className: "inline-icon" })}</a>${
        resume.collected_at
          ? `<span class="doc-link-meta muted"> · ${esc(new Date(resume.collected_at).toLocaleDateString("ko-KR"))}</span>`
          : ""
      }${
        selected?.profile_meta?.resumeLastModified
          ? `<div class="doc-link-note muted">최종수정 ${esc(
              fmtResumeLastModified(selected.profile_meta.resumeLastModified),
            )}</div>`
          : ""
      }`
    : `<span class="muted">없음</span>`;

  const attVal = atts.length
    ? `<span class="doc-link-stack">${atts
        .map((d) => {
          const kind = d.source_label || (d.doc_type === "portfolio" ? "포트폴리오" : "첨부");
          const name = d.source_name || "첨부파일";
          return `<a class="doc-link" href="${esc(d.file_url)}" target="_blank" rel="noopener" title="${esc(kind)}">${esc(
            name,
          )} ${Icon.external({ size: 12, className: "inline-icon" })}</a>`;
        })
        .join("")}</span>`
    : `<span class="muted">없음</span>`;

  return infoRows([
    ["이력서", resumeVal],
    ["첨부", attVal],
  ]);
}

function renderProfileLinkRow(profileUrl, docs, { label = "원본 프로필", listMode = false } = {}) {
  const profileLink = profileUrl
    ? `<a class="profile-origin-link" href="${esc(profileUrl)}" target="_blank" rel="noopener">${esc(label)} ${Icon.external({ size: 14, className: "inline-icon" })}</a>`
    : `<span class="muted">${listMode ? "공고 지원자 목록 링크 없음" : "프로필 링크 없음"}</span>`;
  return `<div class="profile-link-row">${profileLink}</div>`;
}

function applicantListUrl(r) {
  const gi = r?.posting?.external_posting_id;
  const plat = r?.platform || r?.posting?.platform;
  if (plat === "jobkorea" && gi) {
    return `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${encodeURIComponent(gi)}&PageCode=YA`;
  }
  if (plat === "saramin" && gi) {
    return `https://hiring.saramin.co.kr/applicant-manage/recruit/${encodeURIComponent(gi)}`;
  }
  return r?.posting?.meta?.applicantListUrl || r?.profile_meta?.applicantListUrl || null;
}

function renderConfigMissing() {
  appEl.innerHTML = `
    <div class="login-shell">
      <div class="config-warn">
        <strong>Supabase 설정이 없습니다.</strong>
        <p style="margin:8px 0 0">로컬: <code>web/config.example.js</code> → <code>web/config.js</code> 복사 후
        <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> 입력.</p>
      </div>
    </div>`;
}

function renderLogin(errorMsg = "") {
  appEl.innerHTML = `
    <div class="login-shell">
      <form class="login-card" id="login-form">
        <h1 class="brand">TBELL <span>Employ</span></h1>
        <p class="sub">아이디 또는 기업 이메일로 로그인합니다.</p>
        <div class="field">
          <label for="email">아이디 / 이메일</label>
          <input id="email" name="email" type="text" autocomplete="username" required placeholder="tbelltest 또는 name@tbell.co.kr" />
        </div>
        <div class="field">
          <label for="password">비밀번호</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">로그인</button>
        ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ""}
      </form>
    </div>`;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = normalizeLoginId(fd.get("email"));
    const password = String(fd.get("password") || "");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api.signIn(sb, email, password);
      await bootApp();
    } catch (err) {
      renderLogin(err.message || String(err));
    }
  });
}

let dashCharts = [];
let postingStageChart = null;

function destroyDashCharts() {
  for (const c of dashCharts) {
    try {
      c.destroy();
    } catch {
      /* ignore */
    }
  }
  dashCharts = [];
}

function destroyPostingStageChart() {
  try {
    postingStageChart?.destroy?.();
  } catch {
    /* ignore */
  }
  postingStageChart = null;
}

/** 공고 지원자 단계 분포 — 플랫폼 live counts 우선, 없으면 DB stage */
function postingStageBreakdown(apps, metaCounts) {
  if (metaCounts && typeof metaCounts === "object") {
    const live = Object.entries(metaCounts)
      .filter(([k]) => !/전체|^total$/i.test(String(k).trim()))
      .map(([k, v]) => [String(k), Number(v) || 0])
      .filter(([, v]) => v > 0);
    if (live.length) return live;
  }
  /** @type {Record<string, number>} */
  const counts = {};
  for (const a of apps || []) {
    const key = stageLabel(a.current_stage || "applied");
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).filter(([, v]) => v > 0);
}

const STAGE_CHART_COLORS = [
  "#2563eb",
  "#0d9488",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#059669",
  "#64748b",
  "#db2777",
  "#0891b2",
];

function mountPostingStageChart(canvasId, breakdown) {
  destroyPostingStageChart();
  const ChartCtor = window.Chart;
  const canvas = document.getElementById(canvasId);
  if (!ChartCtor || !canvas || !breakdown?.length) return;

  postingStageChart = new ChartCtor(canvas, {
    type: "doughnut",
    data: {
      labels: breakdown.map(([k]) => k),
      datasets: [
        {
          data: breakdown.map(([, v]) => v),
          backgroundColor: breakdown.map((_, i) => STAGE_CHART_COLORS[i % STAGE_CHART_COLORS.length]),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            padding: 10,
            font: { size: 11 },
            color: "#475569",
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              const v = ctx.parsed;
              const pct = Math.round((v / total) * 100);
              return ` ${ctx.label}: ${v}명 (${pct}%)`;
            },
          },
        },
      },
      cutout: "58%",
    },
  });
}

function shell(innerList, innerDetail, { fullWidth = false } = {}) {
  const who = staff?.display_name || staff?.email || "—";
  const role = roleLabel(staff?.role);
  const nick = staff?.nickname ? `@${staff.nickname}` : "";
  const tabs = [
    ["dashboard", `${Icon.dashboard({ size: 15 })} 대시보드`],
    ["postings", `${Icon.posting({ size: 15 })} 공고`],
    ["applicants", `${Icon.users({ size: 15 })} 지원자`],
    ["talent", `${Icon.search({ size: 15 })} 인재검색`],
  ];
  syncHashFromTab();
  appEl.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">TBELL <span>Employ</span></div>
        <nav class="nav">
          ${tabs
            .map(
              ([id, labelText]) =>
                `<button type="button" data-tab="${id}" class="${tab === id ? "active" : ""}">${labelText}</button>`,
            )
            .join("")}
        </nav>
        <div class="userbox">
          <button type="button" class="user-chip" id="btn-profile" title="프로필·알림 설정">
            <span class="user-name">${esc(who)}</span>
            <span class="user-meta">${esc([nick, role].filter(Boolean).join(" · "))}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-logout">로그아웃</button>
        </div>
      </header>
      <div class="main ${fullWidth ? "main-full" : ""}">
        <section class="list-pane" id="list-pane">${innerList}</section>
        ${
          fullWidth
            ? ""
            : `<div class="detail-backdrop" id="detail-backdrop"></div>
               <aside class="detail-pane" id="detail-pane">${innerDetail}</aside>`
        }
      </div>
      <div id="modal-root"></div>
    </div>`;

  appEl.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.getAttribute("data-tab");
      if (!next) return;
      if (next === tab) {
        resetListFilters();
        selected = null;
        selectedPostingApps = [];
        invalidateTabCache(tab);
        await refresh(true);
        return;
      }
      await switchTab(next);
    });
  });
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await api.signOut(sb);
    staff = null;
    renderLogin();
  });
  document.getElementById("btn-profile")?.addEventListener("click", () => openProfileSettings());
  document.getElementById("detail-backdrop")?.addEventListener("click", () => closeDetailDrawer());
  bindPaneWheelRouting();
}

/** 마우스 아래 스크롤 영역만 휠 적용 (목록↔상세 교차 스크롤 방지) */
function bindPaneWheelRouting() {
  if (paneWheelBound) return;
  paneWheelBound = true;
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return; // 브라우저 줌
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      /** @type {Element | null} */
      let target = null;
      for (const node of path) {
        if (!(node instanceof Element)) continue;
        if (
          node.id === "list-pane" ||
          node.classList.contains("detail-scroll") ||
          node.classList.contains("cat-side") ||
          node.classList.contains("side-nav") ||
          node.classList.contains("detail-app-list") ||
          node.classList.contains("interest-list") ||
          node.classList.contains("table-scroll")
        ) {
          const oy = getComputedStyle(node).overflowY;
          if (oy === "auto" || oy === "scroll" || node.id === "list-pane" || node.classList.contains("detail-scroll")) {
            target = node;
            break;
          }
        }
      }
      if (!target) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        target =
          under?.closest(
            "#list-pane, .detail-scroll, .cat-side, .side-nav, .detail-app-list, .interest-list, .table-scroll",
          ) || null;
      }
      if (!target) return;

      // 사이드 내비는 자체 스크롤, 그 외 목록 영역은 list-pane으로 귀속
      if (
        target.classList.contains("cat-side") ||
        target.classList.contains("side-nav")
      ) {
        const can = target.scrollHeight > target.clientHeight + 1;
        if (!can) {
          const list = document.getElementById("list-pane");
          if (list) target = list;
          else return;
        }
      }

      const max = target.scrollHeight - target.clientHeight;
      if (max <= 1) {
        // 스크롤 불가면 부모 목록/상세로 넘기지 않음 (교차 방지)
        if (target.classList.contains("detail-scroll") || target.id === "list-pane") {
          e.preventDefault();
        }
        return;
      }

      e.preventDefault();
      const next = Math.min(max, Math.max(0, target.scrollTop + e.deltaY));
      target.scrollTop = next;
    },
    { passive: false, capture: true },
  );
}

function isCompactLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function openDetailDrawer() {
  document.getElementById("detail-pane")?.classList.add("is-open");
  document.getElementById("detail-backdrop")?.classList.add("is-open");
}

function closeDetailDrawer() {
  selected = null;
  destroyPostingStageChart();
  document.getElementById("detail-pane")?.classList.remove("is-open");
  document.getElementById("detail-backdrop")?.classList.remove("is-open");
  document.body.style.overflow = "";
  document.querySelectorAll(".candidate-card.selected").forEach((x) => x.classList.remove("selected"));
  const pane = document.getElementById("detail-pane");
  if (pane) {
    pane.innerHTML = "";
  }
}

function wrapDetail(title, subtitle, bodyHtml, { badges = "" } = {}) {
  return `
    <div class="detail-header">
      <div class="detail-header-text">
        <div class="detail-title-row">
          <h2>${esc(title)}</h2>
          ${badges ? `<div class="detail-badges">${badges}</div>` : ""}
        </div>
        ${subtitle ? `<p class="detail-sub">${subtitle}</p>` : ""}
      </div>
      <button type="button" class="detail-close" id="btn-detail-close" aria-label="닫기">${Icon.close({ size: 18 })}</button>
    </div>
    <div class="detail-scroll">${bodyHtml}</div>`;
}

function detailSection(title, bodyHtml, { icon = "" } = {}) {
  if (!bodyHtml?.trim()) return "";
  return `<section class="detail-section">
    <h3 class="section-title">${icon ? `<span class="section-icon">${icon}</span>` : ""}${esc(title)}</h3>
    ${bodyHtml}
  </section>`;
}

function detailFacts(items) {
  const rows = items.filter(([, v]) => v != null && v !== "" && v !== "—");
  if (!rows.length) return "";
  return `<div class="detail-facts">${rows
    .map(
      ([k, v]) => `<div class="detail-fact">
        <span class="fact-label">${esc(k)}</span>
        <span class="fact-value">${v}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function infoRows(entries) {
  const rows = entries.filter(([, v]) => v != null && v !== "" && v !== "—");
  if (!rows.length) return `<p class="muted">정보 없음</p>`;
  return `<dl class="info-rows">${rows
    .map(([k, v]) => `<div class="info-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;
}

function renderTagChips(tags, { canRemove = false } = {}) {
  if (!tags.length) return `<p class="muted empty-inline">아직 추천이 없습니다</p>`;
  return `<div class="chip-row tag-chips">${tags
    .map(
      (t) => `<span class="chip tag-chip">
        <span class="tag-type">${esc(label(TAG_LABELS, t.tag_type, t.tag_type))}</span>
        ${t.comment ? `<span class="tag-comment">${esc(t.comment)}</span>` : ""}
        <span class="tag-author">${esc(staffNick(t.staff))}</span>
        ${
          canRemove && caps().canRecommend && t.tagged_by === staff?.id
            ? `<button type="button" data-rm-tag="${esc(t.id)}" title="내 태그 제거" class="icon-btn">${Icon.close({ size: 14 })}</button>`
            : ""
        }
      </span>`,
    )
    .join("")}</div>`;
}

function bindDetailClose() {
  document.getElementById("btn-detail-close")?.addEventListener("click", () => {
    closeDetailDrawer();
  });
}

async function openProfileSettings() {
  // 모든 역할(운영자·추천자·조회자) 공통: 별명·알림 설정
  if (!staff || staff._unlinked || !staff.id) {
    toast("직원 프로필이 연결되지 않았습니다. 관리자에게 문의하세요.", true);
    return;
  }
  const root = document.getElementById("modal-root");
  if (!root) return;

  let openPostings = [];
  let interested = new Set();
  try {
    const [allPostings, interestIds] = await Promise.all([
      api.listPostings(sb, { limit: 500 }),
      api.listMyPostingNotify(sb, staff.id),
    ]);
    openPostings = (allPostings || []).filter((p) => !isPostingClosed(p));
    interested = new Set(interestIds || []);
  } catch (e) {
    toast(e.message || "알림 설정 로드 실패", true);
  }

  const rt =
    staff.notify_realtime != null
      ? Boolean(staff.notify_realtime)
      : staff.notify_pref === "realtime";
  const dg =
    staff.notify_digest != null
      ? Boolean(staff.notify_digest)
      : staff.notify_pref === "digest" || staff.notify_pref === "realtime";

  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card" role="dialog" aria-labelledby="profile-title">
        <div class="detail-header" style="padding:0 0 12px;border:0;background:transparent">
          <div class="detail-header-text">
            <h3 id="profile-title" style="margin:0">내 설정</h3>
            <p class="muted" style="margin:4px 0 0">${esc(staff.email || "")} · ${esc(roleLabel(staff.role))}</p>
          </div>
          <button type="button" class="detail-close" id="pf-cancel" aria-label="닫기">${Icon.close({ size: 18 })}</button>
        </div>
        <div class="stack">
          <div class="pf-field">
            <label for="pf-display">표시 이름</label>
            <input id="pf-display" value="${esc(staff.display_name || "")}" placeholder="예: 주호정" />
          </div>
          <div class="pf-field">
            <label for="pf-nick">별명 (추천 태그에 표시)</label>
            <input id="pf-nick" value="${esc(staff.nickname || "")}" placeholder="예: yj.kim" />
          </div>
          <div class="pf-field">
            <label>메일 알림</label>
            <div class="notify-checks">
              <label><input type="checkbox" id="pf-rt" ${rt ? "checked" : ""} /> 실시간 알림</label>
              <label><input type="checkbox" id="pf-dg" ${dg ? "checked" : ""} /> 모닝 다이제스트 (07:30)</label>
            </div>
          </div>
          <div class="pf-field">
            <label>알림 받을 공고 (진행 중 · 관심)</label>
            <p class="pf-hint">선택하지 않으면 진행 중 공고 전체에 대해 알림을 받습니다. 둘 다 끄면 메일 미수신.</p>
            <div class="interest-list" id="pf-interest">
              ${
                openPostings.length
                  ? openPostings
                      .map(
                        (p) => `<label>
                          <input type="checkbox" data-pid="${esc(p.id)}" ${interested.has(p.id) ? "checked" : ""} />
                          <span>${esc(p.title || "(제목 없음)")}
                            <span class="muted"> · ${esc(platformLabel(p.platform))}</span>
                          </span>
                        </label>`,
                      )
                      .join("")
                  : `<p class="muted">진행 중 공고가 없습니다.</p>`
              }
            </div>
          </div>
        </div>
        <div class="actions" style="margin-top:16px">
          <button type="button" class="btn btn-primary btn-sm" id="pf-save" style="width:auto">저장</button>
        </div>
      </div>
    </div>`;

  const close = () => {
    root.innerHTML = "";
  };
  document.getElementById("pf-cancel")?.addEventListener("click", close);
  document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") close();
  });
  document.getElementById("pf-save")?.addEventListener("click", async () => {
    try {
      const nickname = document.getElementById("pf-nick").value.trim();
      if (!nickname) return toast("별명을 입력하세요", true);
      const notifyRealtime = document.getElementById("pf-rt").checked;
      const notifyDigest = document.getElementById("pf-dg").checked;
      const postingIds = [...document.querySelectorAll("#pf-interest [data-pid]:checked")].map((el) =>
        el.getAttribute("data-pid"),
      );
      staff = await api.updateMyStaffProfile(sb, staff.id, {
        nickname,
        displayName: document.getElementById("pf-display").value.trim(),
        notifyRealtime,
        notifyDigest,
      });
      await api.setMyPostingNotify(sb, staff.id, postingIds);
      toast("설정 저장됨");
      close();
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function listToolbar(title, { showPlatform = true } = {}) {
  const hasAdvanced =
    Boolean(filterHasResume || filterHasAttach || filterSchool || filterProposal) || filterAdvancedOpen;
  const advancedCount = [filterHasResume, filterHasAttach, filterSchool, filterProposal].filter(Boolean)
    .length;

  const applicantPrimary =
    tab === "applicants"
      ? `<select class="select filter-select" id="f-stage" title="단계">
        <option value="">단계 전체</option>
        ${Object.entries(STAGE_LABELS)
          .map(
            ([v, l]) =>
              `<option value="${esc(v)}" ${filterStage === v ? "selected" : ""}>${esc(l)}</option>`,
          )
          .join("")}
      </select>`
      : "";

  const applicantAdvanced =
    tab === "applicants"
      ? `<div class="filter-advanced ${filterAdvancedOpen || advancedCount ? "is-open" : ""}" id="filter-advanced">
      <select class="select filter-select" id="f-resume" title="이력서">
        <option value="">이력서 전체</option>
        <option value="yes" ${filterHasResume === "yes" ? "selected" : ""}>이력서 있음</option>
        <option value="no" ${filterHasResume === "no" ? "selected" : ""}>이력서 없음</option>
      </select>
      <select class="select filter-select" id="f-attach" title="첨부">
        <option value="">첨부 전체</option>
        <option value="yes" ${filterHasAttach === "yes" ? "selected" : ""}>첨부 있음</option>
        <option value="no" ${filterHasAttach === "no" ? "selected" : ""}>첨부 없음</option>
      </select>
      <select class="select filter-select" id="f-school" title="대학/학교">
        <option value="">학교 전체</option>
        ${schoolFilterOptions()
          .map(
            (s) =>
              `<option value="${esc(s)}" ${filterSchool === s ? "selected" : ""}>${esc(s)}</option>`,
          )
          .join("")}
      </select>
    </div>`
      : "";

  const talentAdvanced =
    tab === "talent"
      ? `<div class="filter-advanced ${filterAdvancedOpen || filterProposal ? "is-open" : ""}" id="filter-advanced">
      <select class="select filter-select" id="f-proposal" title="제안 상태">
        <option value="">제안상태 전체</option>
        ${Object.entries(PROPOSAL_STATUS_LABELS)
          .map(
            ([v, l]) =>
              `<option value="${esc(v)}" ${filterProposal === v ? "selected" : ""}>${esc(l)}</option>`,
          )
          .join("")}
      </select>
    </div>`
      : "";

  const showAdvancedToggle = tab === "applicants" || tab === "talent";
  const clearNeeded =
    filterHasResume ||
    filterHasAttach ||
    filterStage ||
    filterSchool ||
    filterProposal ||
    filterQ ||
    (tab === "talent" && filterPlatform);

  return `
    <div class="toolbar">
      <h2>${title}</h2>
      <input class="search" id="q" placeholder="${
        tab === "applicants"
          ? "이름·학교·직무·연락처 검색…"
          : tab === "talent"
            ? "이름·헤드라인 검색…"
            : "검색…"
      }" value="${esc(filterQ)}" />
      ${applicantPrimary}
      ${
        showPlatform
          ? `<select class="select" id="platform">
        <option value="">전체 플랫폼</option>
        <option value="jobkorea" ${filterPlatform === "jobkorea" ? "selected" : ""}>잡코리아</option>
        <option value="saramin" ${filterPlatform === "saramin" ? "selected" : ""}>사람인</option>
      </select>`
          : ""
      }
      ${
        showAdvancedToggle
          ? `<button type="button" class="btn btn-ghost btn-sm filter-more-btn ${hasAdvanced ? "is-active" : ""}" id="btn-filter-more">
              ${Icon.sliders({ size: 14 })} 상세 필터${advancedCount ? ` (${advancedCount})` : ""}
            </button>`
          : ""
      }
      ${
        clearNeeded
          ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-clear-filters">초기화</button>`
          : ""
      }
      <button type="button" class="btn btn-ghost btn-sm" id="btn-refresh">${Icon.refresh({ size: 14 })} 새로고침</button>
    </div>
    ${applicantAdvanced}
    ${talentAdvanced}`;
}

function schoolFilterOptions() {
  const set = new Set();
  for (const r of rows) {
    const school = String(r.profile_meta?.educationSchool || "").trim();
    if (school) set.add(school);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

function bindListChrome() {
  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    invalidateTabCache(tab);
    refresh(false, { forceFetch: true });
  });
  document.getElementById("q")?.addEventListener("change", async (e) => {
    filterQ = e.target.value;
    listPage = 1;
    await refresh(false);
  });
  document.getElementById("q")?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      filterQ = e.target.value;
      listPage = 1;
      await refresh(false);
    }
  });
  document.getElementById("platform")?.addEventListener("change", async (e) => {
    filterPlatform = e.target.value;
    filterPlatformSide = e.target.value;
    listPage = 1;
    await refresh(false);
  });
  document.getElementById("btn-clear-filters")?.addEventListener("click", async () => {
    filterQ = "";
    filterHasResume = "";
    filterHasAttach = "";
    filterStage = "";
    filterSchool = "";
    filterProposal = "";
    if (tab === "talent") {
      filterPlatform = "";
      filterPlatformSide = "";
    }
    listPage = 1;
    selected = null;
    await refresh(true);
  });
  document.getElementById("btn-filter-more")?.addEventListener("click", () => {
    filterAdvancedOpen = !filterAdvancedOpen;
    paintListPane();
  });
  const bindFilterSelect = (id, apply) => {
    document.getElementById(id)?.addEventListener("change", async (e) => {
      apply(e.target.value);
      listPage = 1;
      selected = null;
      paintListPane();
      await renderDetail();
    });
  };
  bindFilterSelect("f-resume", (v) => {
    filterHasResume = v;
  });
  bindFilterSelect("f-attach", (v) => {
    filterHasAttach = v;
  });
  bindFilterSelect("f-stage", (v) => {
    filterStage = v;
  });
  bindFilterSelect("f-school", (v) => {
    filterSchool = v;
  });
  bindFilterSelect("f-proposal", (v) => {
    filterProposal = v;
  });
}

function totalListPages() {
  return Math.max(1, Math.ceil(visibleRows().length / PAGE_SIZE));
}

function visibleRows() {
  if (tab === "postings") {
    return rows.filter((r) => {
      const statusOk =
        filterPostingStatus === "closed" ? isPostingClosed(r) : !isPostingClosed(r);
      const platformOk = !filterPlatformSide || r.platform === filterPlatformSide;
      return statusOk && platformOk;
    });
  }
  if (tab === "applicants") {
    let list = rows.filter((r) => {
      const closed = isPostingClosed(r.posting || {});
      const statusOk = filterPostingStatus === "closed" ? closed : !closed;
      const platformOk =
        !filterPlatformSide || (r.platform || r.posting?.platform) === filterPlatformSide;
      return statusOk && platformOk;
    });
    if (filterApplicantPostingId) {
      list = list.filter((r) => (r.posting?.id || r.posting_id) === filterApplicantPostingId);
    }
    if (filterStage) {
      list = list.filter((r) => r.current_stage === filterStage);
    }
    if (filterSchool) {
      list = list.filter(
        (r) => String(r.profile_meta?.educationSchool || "").trim() === filterSchool,
      );
    }
    if (filterHasResume) {
      list = list.filter((r) => {
        const has = docFlagsFor(r.id).resume;
        return filterHasResume === "yes" ? has : !has;
      });
    }
    if (filterHasAttach) {
      list = list.filter((r) => {
        const has = docFlagsFor(r.id).attach;
        return filterHasAttach === "yes" ? has : !has;
      });
    }
    return list;
  }
  if (tab === "talent") {
    let list = rows;
    const plat = filterPlatformSide || filterPlatform;
    if (plat) list = list.filter((r) => r.platform === plat);
    if (filterCategory !== "all") {
      list = list.filter((r) => resolveTalentCategory(r) === filterCategory);
    }
    if (filterProposal) {
      list = list.filter((r) => r.proposal_status === filterProposal);
    }
    return list;
  }
  return rows;
}

function pageRows() {
  const list = visibleRows();
  const start = (listPage - 1) * PAGE_SIZE;
  return list.slice(start, start + PAGE_SIZE);
}

function clampListPage() {
  listPage = Math.min(Math.max(1, listPage), totalListPages());
}

function syncListPageForSelection() {
  if (!selected?.id || !visibleRows().length) return;
  const idx = visibleRows().findIndex((r) => r.id === selected.id);
  if (idx >= 0) listPage = Math.floor(idx / PAGE_SIZE) + 1;
}

function listTabTitle() {
  return tab === "postings"
    ? `${Icon.posting({ size: 18 })} 채용 공고`
    : tab === "applicants"
      ? `${Icon.users({ size: 18 })} 공고 지원자`
      : `${Icon.search({ size: 18 })} 인재검색`;
}

function listCardsHtml() {
  if (tab === "postings") return renderPostingCards();
  if (tab === "applicants") return renderApplicantsCards();
  return renderTalentCards();
}

function renderPagination() {
  const list = visibleRows();
  if (list.length <= PAGE_SIZE) return "";
  clampListPage();
  const total = totalListPages();
  const from = (listPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(listPage * PAGE_SIZE, list.length);
  const pages = [];
  const windowStart = Math.max(1, listPage - 2);
  const windowEnd = Math.min(total, listPage + 2);
  for (let p = windowStart; p <= windowEnd; p++) {
    pages.push(
      `<button type="button" class="page-num ${p === listPage ? "active" : ""}" data-page="${p}">${p}</button>`,
    );
  }
  return `<nav class="list-pagination" aria-label="페이지">
    <button type="button" class="btn btn-ghost btn-sm page-nav" id="page-prev" ${listPage <= 1 ? "disabled" : ""}>이전</button>
    <div class="page-nums">${pages.join("")}</div>
    <span class="page-info">${from}–${to} / ${list.length}</span>
    <button type="button" class="btn btn-ghost btn-sm page-nav" id="page-next" ${listPage >= total ? "disabled" : ""}>다음</button>
  </nav>`;
}

function talentCategoryNav() {
  if (tab !== "talent") return "";
  const platforms = [
    { id: "jobkorea", label: "잡코리아", mark: "J", markClass: "side-mark-jk" },
    { id: "saramin", label: "사람인", mark: "S", markClass: "side-mark-sr" },
  ];
  const platOf = (r) => r.platform;
  return `<nav class="cat-side side-nav" aria-label="인재 필터">
    ${platforms
      .map((p) => {
        const platRows = rows.filter((r) => platOf(r) === p.id);
        const platActive = filterPlatformSide === p.id || filterPlatform === p.id;
        const catCounts = Object.fromEntries(JOB_CATEGORIES.map((c) => [c.id, 0]));
        catCounts.all = platRows.length;
        for (const r of platRows) {
          const id = resolveTalentCategory(r);
          catCounts[id] = (catCounts[id] || 0) + 1;
        }
        return `<section class="side-section side-plat-tree">
          <button type="button" class="side-item side-plat-head ${platActive && filterCategory === "all" ? "active" : ""}" data-talent-plat="${p.id}" data-cat="all">
            <span class="side-mark ${p.markClass}">${p.mark}</span>
            <span class="side-item-label">${esc(p.label)}</span>
            <span class="side-badge ${platActive ? "side-badge-active" : "side-badge-muted"}">${platRows.length}</span>
          </button>
          <div class="side-nested">
            ${JOB_CATEGORIES.filter((c) => c.id !== "all")
              .map((c) => {
                const n = catCounts[c.id] ?? 0;
                const active = platActive && filterCategory === c.id;
                return `<button type="button" class="side-item side-nested-item ${active ? "active" : ""}" data-talent-plat="${p.id}" data-cat="${c.id}">
                  <span class="side-item-label">${esc(c.short)}</span>
                  <span class="side-badge ${active ? "side-badge-active" : "side-badge-muted"}">${n}</span>
                </button>`;
              })
              .join("")}
          </div>
        </section>`;
      })
      .join("")}
  </nav>`;
}

function statusCounts() {
  if (tab === "applicants") {
    return {
      openN: rows.filter((r) => !isPostingClosed(r.posting || {})).length,
      closedN: rows.filter((r) => isPostingClosed(r.posting || {})).length,
    };
  }
  return {
    openN: rows.filter((r) => !isPostingClosed(r)).length,
    closedN: rows.filter((r) => isPostingClosed(r)).length,
  };
}

function platformCountsFor(status) {
  const base =
    tab === "applicants"
      ? rows.filter((r) => {
          const closed = isPostingClosed(r.posting || {});
          return status === "closed" ? closed : !closed;
        })
      : rows.filter((r) =>
          status === "closed" ? isPostingClosed(r) : !isPostingClosed(r),
        );
  const platOf = (r) =>
    tab === "applicants" ? r.platform || r.posting?.platform : r.platform;
  return {
    jk: base.filter((r) => platOf(r) === "jobkorea").length,
    sr: base.filter((r) => platOf(r) === "saramin").length,
  };
}

function sideSummaryCard() {
  const { openN, closedN } = statusCounts();
  const openActive = filterPostingStatus === "open";
  return `<div class="side-summary" role="group" aria-label="진행/마감">
    <div class="side-summary-icon" aria-hidden="true">
      <span class="side-summary-ring"></span>
      ${Icon.clipboard({ size: 18, className: "side-summary-clip" })}
    </div>
    <div class="side-summary-stats">
      <button type="button" class="side-summary-stat ${openActive ? "is-active" : ""}" data-pstatus="open">
        <span class="side-summary-label">${esc(POSTING_STATUS_SIDE.open)}</span>
        <span class="side-summary-num">${openN}</span>
      </button>
      <button type="button" class="side-summary-stat ${!openActive ? "is-active" : ""}" data-pstatus="closed">
        <span class="side-summary-label">${esc(POSTING_STATUS_SIDE.closed)}</span>
        <span class="side-summary-num">${closedN}</span>
      </button>
    </div>
  </div>`;
}

/** 플랫폼 대분류 → (지원자 탭) 공고 소분류 */
function sidePlatformTree({ withPostings = false } = {}) {
  const status = filterPostingStatus === "closed" ? "closed" : "open";
  const counts = platformCountsFor(status);
  const platforms = [
    { id: "jobkorea", label: "잡코리아", mark: "J", markClass: "side-mark-jk", n: counts.jk },
    { id: "saramin", label: "사람인", mark: "S", markClass: "side-mark-sr", n: counts.sr },
  ];

  return platforms
    .map((p) => {
      const platActive = filterPlatformSide === p.id;
      const postings = withPostings
        ? postingNavRows.filter((row) => {
            const closed = isPostingClosed(row);
            const statusOk = status === "closed" ? closed : !closed;
            return statusOk && row.platform === p.id;
          })
        : [];
      const platAppCount = withPostings
        ? rows.filter((r) => {
            const closed = isPostingClosed(r.posting || {});
            const statusOk = status === "closed" ? closed : !closed;
            return statusOk && (r.platform || r.posting?.platform) === p.id;
          }).length
        : p.n;

      return `<section class="side-section side-plat-tree">
        <button type="button" class="side-item side-plat-head ${platActive && !filterApplicantPostingId ? "active" : ""}" data-pstatus="${status}" data-platform="${p.id}" data-app-posting="">
          <span class="side-mark ${p.markClass}">${p.mark}</span>
          <span class="side-item-label">${esc(p.label)}</span>
          <span class="side-badge ${platActive ? "side-badge-active" : "side-badge-muted"}">${withPostings ? platAppCount : p.n}</span>
        </button>
        ${
          withPostings
            ? `<div class="side-nested ${platActive ? "" : "is-collapsed"}">
            <button type="button" class="side-item side-nested-item ${platActive && !filterApplicantPostingId ? "active" : ""}" data-pstatus="${status}" data-platform="${p.id}" data-app-posting="">
              <span class="side-item-label">전체</span>
              <span class="side-badge ${platActive && !filterApplicantPostingId ? "side-badge-active" : "side-badge-muted"}">${platAppCount}</span>
            </button>
            ${postings
              .map((post) => {
                const n = rows.filter((r) => (r.posting?.id || r.posting_id) === post.id).length;
                const active = filterApplicantPostingId === post.id;
                return `<button type="button" class="side-item side-nested-item ${active ? "active" : ""}" data-pstatus="${status}" data-platform="${p.id}" data-app-posting="${esc(post.id)}" title="${esc(post.title || "")}">
                  <span class="side-item-label">${esc(post.title || "(제목 없음)")}</span>
                  <span class="side-badge ${active ? "side-badge-active" : "side-badge-muted"}">${n}</span>
                </button>`;
              })
              .join("")}
          </div>`
            : ""
        }
      </section>`;
    })
    .join("");
}

function postingStatusNav() {
  if (tab !== "postings") return "";
  return `<nav class="cat-side side-nav" aria-label="공고 필터">
    ${sideSummaryCard()}
    ${sidePlatformTree({ withPostings: false })}
  </nav>`;
}

function applicantSideNav() {
  if (tab !== "applicants") return "";
  return `<nav class="cat-side side-nav" aria-label="지원자 필터">
    ${sideSummaryCard()}
    ${sidePlatformTree({ withPostings: true })}
  </nav>`;
}

function renderPostingApplicantsInDetail() {
  const blocked = selected?.meta?.applicantAccessBlocked;
  const liveTotal = selected?.meta?.applicantCounts
    ? Object.entries(selected.meta.applicantCounts).find(([k]) => k.includes("전체"))?.[1]
    : null;
  if (!selectedPostingApps.length) {
    const emptyMsg = blocked
      ? `${platformLabel(selected?.platform || "jobkorea")} 정책상 최근 90일 이내 공고만 지원자 상세를 열 수 있습니다.${
          liveTotal != null ? ` 목록상 전체 ${liveTotal}명은 표시되나 상세 수집은 불가합니다.` : ""
        }`
      : "이 공고에 수집된 지원자가 없습니다.";
    return `<div class="posting-apps-panel">
      <h3 class="section-title">이 공고 지원자 <span class="muted">0명</span></h3>
      <div class="empty">${esc(emptyMsg)}</div>
    </div>`;
  }
  return `<div class="posting-apps-panel">
    <h3 class="section-title">이 공고 지원자 <span class="muted">${selectedPostingApps.length}명${
      liveTotal != null ? ` / 전체 ${liveTotal}` : ""
    }</span></h3>
    <div class="card-list detail-app-list">${selectedPostingApps
      .map((r) => {
        const meta = r.profile_meta || {};
        const name = r.candidate?.name || "(이름 없음)";
        return `<article class="candidate-card" data-goto-app="${esc(r.id)}">
          <div class="card-name-row">
            <span class="card-name">${esc(name)}</span>
            ${isNew(r.created_at || r.applied_at) ? `<span class="badge new">NEW</span>` : ""}
            <span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span>
          </div>
          <div class="card-sub">${esc(
            [meta.genderAge, meta.careerTotal, meta.position].filter(Boolean).join(" · ") || "—",
          )}</div>
        </article>`;
      })
      .join("")}</div>
  </div>`;
}

function listContentHtml() {
  const body = `${listToolbar(listTabTitle(), {
    showPlatform: tab === "talent",
  })}${listCardsHtml()}${renderPagination()}`;
  if (tab === "talent") {
    return `<div class="talent-layout">${talentCategoryNav()}<div class="talent-main">${body}</div></div>`;
  }
  if (tab === "postings") {
    return `<div class="talent-layout">${postingStatusNav()}<div class="talent-main">${body}</div></div>`;
  }
  if (tab === "applicants") {
    return `<div class="talent-layout">${applicantSideNav()}<div class="talent-main">${body}</div></div>`;
  }
  return body;
}

function paintListPane() {
  const pane = document.getElementById("list-pane");
  if (!pane) return;
  pane.innerHTML = listContentHtml();
  bindListChrome();
  bindPagination();
  bindCardSelection();
  bindTalentCategoryNav();
  bindPostingStatusNav();
  bindApplicantSideNav();
  if (selected?.id) {
    document.querySelector(`.candidate-card[data-id="${selected.id}"]`)?.classList.add("selected");
  }
}

function bindTalentCategoryNav() {
  document.querySelectorAll("[data-talent-plat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const plat = btn.getAttribute("data-talent-plat") || "";
      const cat = btn.getAttribute("data-cat") || "all";
      if (plat === filterPlatformSide && cat === filterCategory) return;
      filterPlatformSide = plat;
      filterPlatform = plat;
      filterCategory = cat;
      listPage = 1;
      selected = null;
      paintListPane();
      await renderDetail();
    });
  });
}

function bindPostingStatusNav() {
  document.querySelectorAll(".side-summary-stat[data-pstatus]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.getAttribute("data-pstatus") || "open";
      if (next === filterPostingStatus) {
        // 같은 상태 재클릭 → 플랫폼 필터 해제
        if (filterPlatformSide || filterApplicantPostingId) {
          filterPlatformSide = "";
          filterApplicantPostingId = "";
          listPage = 1;
          selected = null;
          selectedPostingApps = [];
          paintListPane();
          await renderDetail();
        }
        return;
      }
      filterPostingStatus = next;
      filterPlatformSide = "";
      filterApplicantPostingId = "";
      listPage = 1;
      selected = null;
      selectedPostingApps = [];
      paintListPane();
      await renderDetail();
    });
  });

  document.querySelectorAll(".side-plat-tree [data-platform]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextStatus = btn.getAttribute("data-pstatus") || filterPostingStatus;
      const nextPlatform = btn.getAttribute("data-platform") || "";
      const nextPosting =
        btn.getAttribute("data-app-posting") != null ? btn.getAttribute("data-app-posting") || "" : "";

      filterPostingStatus = nextStatus;
      filterPlatformSide = nextPlatform;
      filterApplicantPostingId = nextPosting;
      listPage = 1;
      selected = null;
      selectedPostingApps = [];
      paintListPane();
      await renderDetail();
    });
  });
}

function bindApplicantSideNav() {
  // platform tree 핸들러는 bindPostingStatusNav 에서 공통 처리
}

function bindPostingAppsBelow() {
  document.querySelectorAll("[data-goto-app]").forEach((card) => {
    card.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = card.getAttribute("data-goto-app");
      const posting = selected;
      tab = "applicants";
      resetListFilters();
      filterPostingStatus = posting && isPostingClosed(posting) ? "closed" : "open";
      filterApplicantPostingId = posting?.id || "";
      syncHashFromTab();
      await refresh(true);
      selected = rows.find((r) => r.id === id) || null;
      if (selected) {
        syncListPageForSelection();
        paintListPane();
        await renderDetail();
      }
    });
  });
}

function bindPagination() {
  document.getElementById("page-prev")?.addEventListener("click", async () => {
    if (listPage <= 1) return;
    listPage -= 1;
    selected = null;
    paintListPane();
    await renderDetail();
  });
  document.getElementById("page-next")?.addEventListener("click", async () => {
    if (listPage >= totalListPages()) return;
    listPage += 1;
    selected = null;
    paintListPane();
    await renderDetail();
  });
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = Number(btn.getAttribute("data-page"));
      if (!p || p === listPage) return;
      listPage = p;
      selected = null;
      paintListPane();
      await renderDetail();
    });
  });
}

let dashTrendMode = "apps"; // apps | talents

function renderDashboard() {
  const s = dashboardStats || {
    applicants: 0,
    talents: 0,
    postings: 0,
    documents: 0,
    applicantsYesterday: 0,
    applicantsThisWeek: 0,
    yesterdayLabel: "",
    weekLabel: "",
    recentApps: [],
    appsDaily: { labels: [], values: [] },
    talentsDaily: { labels: [], values: [] },
  };

  const recent = (s.recentApps || [])
    .map(
      (r) => `<tr class="dash-row" data-goto-app="${esc(r.id)}">
        <td><b>${esc(r.candidate?.name || "(이름 없음)")}</b></td>
        <td class="muted">${esc(r.posting?.title || "공고 미연결")}</td>
        <td><span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span></td>
        <td class="muted">${esc(fmtDate(r.applied_at))}</td>
      </tr>`,
    )
    .join("");

  const trendTitle = dashTrendMode === "talents" ? "일별 인재검색 추이" : "일별 지원 추이";

  return `
    <div class="dash-page">
      <div class="toolbar">
        <h2>대시보드</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-refresh">새로고침</button>
      </div>
      <div class="dash-links">
        <a class="dash-link" href="https://www.jobkorea.co.kr/Corp/Main" target="_blank" rel="noopener">잡코리아 기업회원 ${Icon.external({ size: 13 })}</a>
        <a class="dash-link" href="https://www.saramin.co.kr/zf_user/memcom/main" target="_blank" rel="noopener">사람인 기업회원 ${Icon.external({ size: 13 })}</a>
      </div>
      <div class="dash-kpis">
        <button type="button" class="dash-card" data-jump="applicants">
          <div class="dash-label">어제 지원자</div>
          <div class="dash-num">${s.applicantsYesterday ?? 0}</div>
          <div class="dash-sub muted">${esc(s.yesterdayLabel || "전일")}</div>
        </button>
        <button type="button" class="dash-card" data-jump="applicants">
          <div class="dash-label">이번주 지원자</div>
          <div class="dash-num">${s.applicantsThisWeek ?? 0}</div>
          <div class="dash-sub muted">${esc(s.weekLabel || "월–오늘")}</div>
        </button>
        <button type="button" class="dash-card" data-jump="talent">
          <div class="dash-label">인재검색</div>
          <div class="dash-num">${s.talents}</div>
          <div class="dash-sub muted">누적</div>
        </button>
        <button type="button" class="dash-card" data-jump="postings">
          <div class="dash-label">공고</div>
          <div class="dash-num">${s.postings}</div>
          <div class="dash-sub muted">누적</div>
        </button>
      </div>
      <div class="dash-charts dash-charts-single">
        <div class="panel chart-panel chart-panel-wide">
          <div class="chart-head">
            <h3>${trendTitle} <span class="muted chart-sub">최근 14일</span></h3>
            <div class="chart-filters" role="group" aria-label="추이 필터">
              <button type="button" class="chip-filter ${dashTrendMode === "apps" ? "active" : ""}" data-trend="apps">지원자</button>
              <button type="button" class="chip-filter ${dashTrendMode === "talents" ? "active" : ""}" data-trend="talents">인재검색</button>
            </div>
          </div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-trend-daily"></canvas></div>
        </div>
      </div>
      <div class="panel dash-recent">
        <h3>최근 지원자</h3>
        <div class="table-scroll">
          <table class="dash-table">
            <thead>
              <tr><th>이름</th><th>공고</th><th>단계</th><th>지원일</th></tr>
            </thead>
            <tbody>${recent || `<tr><td colspan="4" class="muted">없음</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function mountDashboardCharts() {
  destroyDashCharts();
  const ChartCtor = window.Chart;
  if (!ChartCtor || !dashboardStats) return;

  const s = dashboardStats;
  const isTalent = dashTrendMode === "talents";
  const series = isTalent ? s.talentsDaily : s.appsDaily;
  const color = isTalent ? "#0d9488" : "#2563eb";
  const soft = isTalent ? "rgba(13, 148, 136, 0.15)" : "rgba(37, 99, 235, 0.15)";

  const commonScale = {
    grid: { color: "rgba(15, 23, 42, 0.06)" },
    ticks: { color: "#64748b", font: { size: 11 } },
  };

  const canvas = document.getElementById("chart-trend-daily");
  if (!canvas) return;

  dashCharts.push(
    new ChartCtor(canvas, {
      type: "line",
      data: {
        labels: series?.labels || [],
        datasets: [
          {
            label: isTalent ? "인재" : "지원",
            data: series?.values || [],
            borderColor: color,
            backgroundColor: soft,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: commonScale,
          y: { ...commonScale, beginAtZero: true, ticks: { ...commonScale.ticks, precision: 0 } },
        },
      },
    }),
  );

  document.querySelectorAll("[data-trend]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-trend");
      if (!mode || mode === dashTrendMode) return;
      dashTrendMode = mode;
      const listPane = document.getElementById("list-pane");
      if (!listPane) return;
      listPane.innerHTML = renderDashboard();
      document.getElementById("btn-refresh")?.addEventListener("click", () => {
        invalidateTabCache("dashboard");
        refresh(false, { forceFetch: true });
      });
      document.querySelectorAll("[data-jump]").forEach((b) => {
        b.addEventListener("click", async () => {
          tab = b.getAttribute("data-jump");
          selected = null;
          resetListFilters();
          syncHashFromTab();
          await refresh(true);
        });
      });
      document.querySelectorAll("[data-goto-app]").forEach((b) => {
        b.addEventListener("click", async () => {
          tab = "applicants";
          resetListFilters();
          syncHashFromTab();
          await refresh(true);
          selected = rows.find((r) => r.id === b.getAttribute("data-goto-app")) || null;
          if (selected) {
            syncListPageForSelection();
            paintListPane();
            await renderDetail();
          }
        });
      });
      mountDashboardCharts();
    });
  });
}

function renderPostingCards() {
  if (!visibleRows().length) {
    return `<div class="empty">${
      filterPostingStatus === "closed" ? "마감된 공고가 없습니다." : "진행 중 공고가 없습니다."
    }</div>`;
  }
  return `<div class="card-list posting-cards">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.meta || {};
      const n = r.applicant_count ?? 0;
      const liveTotal = meta.applicantCounts
        ? Object.entries(meta.applicantCounts).find(([k]) => /전체|^total$/i.test(String(k)))?.[1]
        : null;
      const views = meta.viewCount != null ? Number(meta.viewCount) : null;
      const recommends = meta.recommendCount != null ? Number(meta.recommendCount) : null;
      const countTitle =
        liveTotal != null
          ? `수집 ${n}명 · 플랫폼 전체 ${liveTotal}명`
          : `수집 지원자 ${n}명`;
      const countLabel =
        liveTotal != null && Number(liveTotal) !== n ? `${n}/${liveTotal}` : String(n);
      const subParts = [
        meta.manager,
        meta.period,
        meta.status,
        views != null ? `조회 ${views.toLocaleString("ko-KR")}` : "",
        recommends != null ? `추천 ${recommends.toLocaleString("ko-KR")}` : "",
      ].filter(Boolean);
      const sub = subParts.join(" · ");
      return `<article class="candidate-card posting-card ${sel}" data-id="${esc(r.id)}">
        <div class="posting-card-row">
          <span class="posting-plat" title="${esc(platformLabel(r.platform))}">${platformIcon(r.platform, { large: true })}</span>
          <div class="posting-card-main">
            <div class="posting-title-row">
              <span class="card-name" title="${esc(r.title || "")}">${esc(r.title || "(제목 없음)")}</span>
              <span class="posting-app-count" title="${esc(countTitle)}">${esc(countLabel)}</span>
            </div>
            ${sub ? `<div class="card-sub posting-meta-line" title="${esc(sub)}">${esc(sub)}</div>` : ""}
          </div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderApplicantsCards() {
  if (!visibleRows().length) {
    return `<div class="empty">${
      filterApplicantPostingId
        ? "이 공고에 해당하는 지원자가 없습니다."
        : filterPostingStatus === "closed"
          ? "마감 공고 지원자가 없습니다."
          : "진행 중 공고 지원자가 없습니다. 크롤 수집 후 새로고침하세요."
    }</div>`;
  }
  return `<div class="card-list applicant-cards">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.profile_meta || {};
      const name = r.candidate?.name || "(이름 없음)";
      const posting = r.posting?.title || "공고명 미수집";
      const position = String(meta.position || "").trim();
      const postingLine =
        position && position !== posting ? `${posting} · ${position}` : posting;
      const flags = docFlagsFor(r.id);
      const badges = [
        isNew(r.created_at || r.applied_at) ? `<span class="badge new">NEW</span>` : "",
        !r.is_active || !r.candidate?.is_active ? `<span class="badge blocked">블락</span>` : "",
        flags.resume
          ? `<span class="badge doc-ok" title="이력서 있음">${Icon.file({ size: 13 })}</span>`
          : `<span class="badge doc-miss" title="이력서 없음">${Icon.fileMissing({ size: 13 })}</span>`,
        flags.attach
          ? `<span class="badge doc-ok" title="첨부 있음">${Icon.paperclip({ size: 13 })}</span>`
          : "",
      ].join(" ");
      const edu =
        [meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" · ") ||
        meta.education ||
        "";
      const infoLine = [meta.genderAge, meta.careerTotal, edu].filter(Boolean).join(" · ");

      return `<article class="candidate-card applicant-card ${sel}" data-id="${esc(r.id)}">
        <div class="card-top">
          <div class="card-top-main">
            <div class="card-name-row">
              <span class="card-name">${esc(name)}</span>
              ${badges}
            </div>
            ${infoLine ? `<div class="card-sub card-sub-wrap">${esc(infoLine)}</div>` : ""}
          </div>
          <div class="card-top-side">
            <span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span>
            ${meta.desiredSalary ? `<span class="card-salary">${esc(meta.desiredSalary)}</span>` : ""}
          </div>
        </div>
        <div class="applicant-posting-row">
          <span class="posting-plat" title="${esc(platformLabel(r.platform))}">${platformIcon(r.platform)}</span>
          <span class="card-posting">${esc(postingLine)}</span>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderTalentCards() {
  if (!rows.length) return `<div class="empty">인재검색 후보가 없습니다.</div>`;
  return `<div class="card-list">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.profile_meta || {};
      const name = r.candidate?.name || meta.name || "(이름 없음)";
      const headline = r.headline || "";
      const badges = [
        isNew(r.sourced_at) ? `<span class="badge new">NEW</span>` : "",
        !r.is_active ? `<span class="badge blocked">블락</span>` : "",
      ].join(" ");
      const subParts = [meta.genderAge, meta.careerText].filter(Boolean);

      return `<article class="candidate-card ${sel}" data-id="${esc(r.id)}">
        <div class="card-top">
          <div class="card-top-main">
            ${headline ? `<p class="card-headline">${esc(headline)}</p>` : ""}
            <div class="card-name-row">
              <span class="card-name">${esc(name)}</span>
              ${badges}
            </div>
            ${subParts.length ? `<div class="card-sub">${esc(subParts.join(" · "))}</div>` : ""}
          </div>
          <div class="card-top-side">
            <span class="meta-pill stage">${esc(proposalLabel(r.proposal_status))}</span>
            <span class="meta-pill cat">${esc(categoryShort(resolveTalentCategory(r)))}</span>
            ${meta.company ? `<span class="card-salary">${esc(meta.company)}</span>` : ""}
          </div>
        </div>
        <div class="card-meta-row">
          <span class="meta-pill platform" title="${esc(platformLabel(r.platform))}">${platformIcon(r.platform)}</span>
        </div>
        ${renderChips(meta.badges, "badge-chip")}
        ${renderChips(meta.roles?.slice(0, 6))}
        ${renderChips(meta.skills?.slice(0, 8))}
      </article>`;
    })
    .join("")}</div>`;
}

function stageOptions(current) {
  return Object.entries(STAGE_LABELS)
    .map(([v, l]) => `<option value="${v}" ${current === v ? "selected" : ""}>${esc(l)}</option>`)
    .join("");
}

async function renderDetail() {
  const pane = document.getElementById("detail-pane");
  if (!pane || tab === "dashboard") return;

  if (!selected) {
    destroyPostingStageChart();
    pane.classList.remove("is-open");
    document.getElementById("detail-backdrop")?.classList.remove("is-open");
    document.body.style.overflow = "";
    pane.innerHTML = "";
    return;
  }

  if ((tab === "applicants" || tab === "talent") && (staff?._unlinked || !staff?.id)) {
    pane.innerHTML = wrapDetail(
      "권한 연결 필요",
      "관리자에게 문의하세요",
      `<div class="panel"><p class="muted">로그인은 됐지만 staff_profiles 가 연결되지 않았습니다.</p></div>`,
    );
    bindDetailClose();
    openDetailDrawer();
    return;
  }

  if (tab === "postings") await renderPostingDetail(pane);
  else if (tab === "applicants") await renderApplicantDetail(pane);
  else await renderTalentDetail(pane);

  bindDetailClose();
  openDetailDrawer();
}

async function renderPostingDetail(pane) {
  const r = selected;
  const meta = r.meta || {};
  const liveTotal = meta.applicantCounts
    ? Object.entries(meta.applicantCounts).find(([k]) => /전체|^total$/i.test(String(k)))?.[1]
    : null;
  const views = meta.viewCount != null ? Number(meta.viewCount) : null;
  const recommends = meta.recommendCount != null ? Number(meta.recommendCount) : null;
  const breakdown = postingStageBreakdown(selectedPostingApps, meta.applicantCounts);
  const breakdownTotal = breakdown.reduce((s, [, v]) => s + v, 0);
  const sourceHint = meta.applicantCounts
    ? Object.keys(meta.applicantCounts).some((k) => !/전체|^total$/i.test(k))
      ? "플랫폼 집계"
      : "수집 데이터"
    : "수집 데이터";

  const chartHtml = breakdown.length
    ? `<div class="detail-block posting-stage-block">
        <h3 class="section-title">${Icon.chart({ size: 15 })} 지원자 현황
          <span class="muted chart-sub">${esc(sourceHint)} · ${breakdownTotal}명</span>
        </h3>
        <div class="posting-stage-chart-wrap"><canvas id="chart-posting-stages"></canvas></div>
        <div class="posting-stage-legend-nums">
          ${breakdown
            .map(
              ([k, v]) =>
                `<span class="stage-stat"><b>${esc(String(v))}</b> ${esc(k)}</span>`,
            )
            .join("")}
        </div>
      </div>`
    : `<div class="detail-block">
        <h3 class="section-title">${Icon.chart({ size: 15 })} 지원자 현황</h3>
        <p class="muted empty-inline">집계할 지원자 현황이 없습니다.</p>
      </div>`;

  const body = `
    ${detailSection(
      "공고 정보",
      infoRows([
        ["상태", esc(meta.status || (isPostingClosed(r) ? "마감" : "진행 중"))],
        ["담당자", esc(meta.manager || "—")],
        ["기간", esc(meta.period || "—")],
        [
          "지원자",
          `${selectedPostingApps.length || r.applicant_count || 0}명 수집${
            liveTotal != null ? ` · ${platformLabel(r.platform)} 전체 ${Number(liveTotal).toLocaleString("ko-KR")}명` : ""
          }`,
        ],
        [
          "조회수",
          views != null ? `${views.toLocaleString("ko-KR")}` : "—",
        ],
        [
          "추천수",
          recommends != null ? `${recommends.toLocaleString("ko-KR")}` : "—",
        ],
        [
          "원본 링크",
          r.source_url
            ? `<a class="doc-link" href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(platformLabel(r.platform))}에서 보기 ${Icon.external({ size: 13, className: "inline-icon" })}</a>`
            : "—",
        ],
      ]),
      { icon: Icon.clipboard({ size: 16 }) },
    )}
    ${chartHtml}
    <div class="detail-actions">
      <button type="button" class="btn btn-primary btn-sm" id="btn-view-apps">지원자 탭에서 보기</button>
    </div>
    ${renderPostingApplicantsInDetail()}`;

  pane.innerHTML = wrapDetail(r.title || "(제목 없음)", "", body, {
    badges: `${platformIcon(r.platform, { large: true })}`,
  });

  mountPostingStageChart("chart-posting-stages", breakdown);

  document.getElementById("btn-view-apps")?.addEventListener("click", async () => {
    tab = "applicants";
    resetListFilters();
    filterPostingStatus = isPostingClosed(r) ? "closed" : "open";
    filterApplicantPostingId = r.id;
    selected = null;
    destroyPostingStageChart();
    syncHashFromTab();
    await refresh(true);
  });
  bindPostingAppsBelow();
}

async function renderApplicantDetail(pane) {
  const r = selected;
  const candidateId = r.candidate?.id;
  const meta = r.profile_meta || {};
  const [tags, interviews, history, docs] = await Promise.all([
    api.listTags(sb, "applicant", r.id),
    api.listInterviews(sb, candidateId),
    api.listStatusHistory(sb, candidateId),
    api.listDocuments(sb, { candidateId, applicationId: r.id }),
  ]);

  const name = r.candidate?.name || "(이름 없음)";
  const edu = [meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" · ");
  const headerBadges = [
    platformIcon(r.platform, { large: true }),
    `<span class="stage-pill">${esc(stageLabel(r.current_stage))}</span>`,
    isNew(r.applied_at) ? `<span class="badge new">NEW</span>` : "",
    !r.is_active || !r.candidate?.is_active ? `<span class="badge blocked">블락</span>` : "",
    meta.platformStatus ? `<span class="badge">${esc(meta.platformStatus)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const subBits = [meta.position, meta.genderAge, meta.careerTotal ? `경력 ${meta.careerTotal}` : ""]
    .filter(Boolean)
    .map(esc)
    .join(" · ");

  const overview = `<div class="detail-block">
    ${infoRows([
      ["희망연봉", esc(meta.desiredSalary || "—")],
      ["경력", esc(meta.careerTotal || "—")],
      ["학력", esc(edu || "—")],
      ["지원일", esc(fmtDate(r.applied_at))],
      ["이력서 수정", meta.resumeLastModified ? esc(fmtResumeLastModified(meta.resumeLastModified)) : "—"],
      ["이메일", esc(r.candidate?.email || "—")],
      ["공고", esc(r.posting?.title || "공고명 미수집")],
      [
        "공고 링크",
        r.posting?.source_url
          ? `<a class="doc-link" href="${esc(r.posting.source_url)}" target="_blank" rel="noopener">${esc(platformLabel(r.platform))} 열기 ${Icon.external({ size: 12, className: "inline-icon" })}</a>`
          : "—",
      ],
      [
        "지원자 목록",
        (() => {
          const u = applicantListUrl(r);
          return u
            ? `<a class="doc-link" href="${esc(u)}" target="_blank" rel="noopener">${esc(platformLabel(r.platform))} 목록 ${Icon.external({ size: 12, className: "inline-icon" })}</a>`
            : "—";
        })(),
      ],
    ])}
    ${meta.recommendTags?.length ? renderChips(meta.recommendTags, "badge-chip") : ""}
    ${meta.careerHistory?.length ? renderChips(meta.careerHistory) : ""}
  </div>`;

  const docsHtml = `<div class="detail-block">
    <h3 class="section-title">${Icon.folder({ size: 15 })} 서류</h3>
    ${renderDocuments(docs)}
    ${
      caps().canRecommend
        ? `<div class="detail-actions">
            <button type="button" class="btn btn-primary btn-sm" id="btn-recommend">${Icon.star({ size: 14 })} 추천하기</button>
            <span class="muted detail-hint">${esc(staff?.nickname || "")}</span>
          </div>`
        : ""
    }
  </div>`;

  const tagsHtml = `<div class="detail-block">
    <h3 class="section-title">${Icon.tag({ size: 15 })} 태그</h3>
    ${renderTagChips(tags, { canRemove: true })}
    ${
      caps().canTagExtra
        ? `<div class="stack tag-form compact-form">
        <select id="tag-type">
          ${Object.entries(TAG_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <input id="tag-comment" placeholder="코멘트 (선택)" />
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-tag">저장</button>
      </div>`
        : ""
    }
  </div>`;

  const pipelineHtml = caps().canManagePipeline
    ? `<div class="detail-block">
        <h3 class="section-title">${Icon.calendar({ size: 15 })} 면접 · 상태</h3>
        <ul class="timeline">
        ${
          interviews.length
            ? interviews
                .map(
                  (i) => `<li><b>${esc(label(INTERVIEW_RESULT_LABELS, i.result, i.result))}</b>
                    · ${esc(new Date(i.interview_at).toLocaleString("ko-KR"))}
                    · ${esc(label(MEETING_LABELS, i.meeting_type, i.meeting_type))}
                    ${i.interviewer ? `· ${esc(i.interviewer)}` : ""}
                    ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ""}</li>`,
                )
                .join("")
            : `<li class="muted">면접 일정 없음</li>`
        }
      </ul>
      <div class="stack form-block compact-form">
        <input id="iv-at" type="datetime-local" />
        <input id="iv-who" placeholder="면접관" />
        <select id="iv-type">
          ${Object.entries(MEETING_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <textarea id="iv-note" placeholder="메모"></textarea>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-schedule">일정 저장</button>
      </div>
      ${
        interviews[0]
          ? `<div class="stack form-block compact-form">
              <select id="iv-result">
                ${Object.entries(INTERVIEW_RESULT_LABELS)
                  .filter(([k]) => k !== "scheduled")
                  .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
                  .join("")}
              </select>
              <input id="iv-hired" type="date" />
              <button type="button" class="btn btn-ghost btn-sm" id="btn-iv-result"
                data-ivid="${esc(interviews[0].id)}">결과 반영</button>
            </div>`
          : ""
      }
      <div class="stack form-block compact-form" style="margin-top:10px">
        <select id="stage">${stageOptions(r.current_stage)}</select>
        <input id="stage-reason" placeholder="사유" />
        <div class="detail-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btn-stage">단계 저장</button>
          ${caps().canBlock ? `<button type="button" class="btn btn-danger btn-sm" id="btn-block">블락</button>` : ""}
        </div>
      </div>
      <ul class="timeline">
        ${
          history.length
            ? history
                .map(
                  (h) => `<li><b>${esc(stageLabel(h.status_code) !== "—" ? stageLabel(h.status_code) : h.status_code)}</b>
                    · ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}
                    · ${esc(staffNick(h.staff))}
                    ${h.reason ? `<div class="muted">${esc(h.reason)}</div>` : ""}</li>`,
                )
                .join("")
            : `<li class="muted">상태 이력 없음</li>`
        }
      </ul>
    </div>`
    : `<div class="detail-block">
        <h3 class="section-title">${Icon.pin({ size: 15 })} 상태</h3>
        <p class="stage-readonly">현재: <strong>${esc(stageLabel(r.current_stage))}</strong></p>
        <ul class="timeline">
        ${
          history.length
            ? history
                .map(
                  (h) => `<li><b>${esc(stageLabel(h.status_code) !== "—" ? stageLabel(h.status_code) : h.status_code)}</b>
                    · ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}
                    · ${esc(staffNick(h.staff))}</li>`,
                )
                .join("")
            : `<li class="muted">이력 없음</li>`
        }
      </ul>
    </div>`;

  pane.innerHTML = wrapDetail(name, subBits, [overview, docsHtml, tagsHtml, pipelineHtml].join(""), {
    badges: headerBadges,
  });

  bindApplicantActions(r, candidateId);
}

function bindApplicantActions(r, candidateId) {
  document.getElementById("btn-recommend")?.addEventListener("click", async () => {
    try {
      await api.addTag(sb, {
        targetType: "applicant",
        targetId: r.id,
        tagType: "recommend",
        comment: "",
        staffId: staff.id,
      });
      toast(`${staff.nickname || "나"} 추천 등록`);
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-add-tag")?.addEventListener("click", async () => {
    try {
      await api.addTag(sb, {
        targetType: "applicant",
        targetId: r.id,
        tagType: document.getElementById("tag-type").value,
        comment: document.getElementById("tag-comment").value,
        staffId: staff.id,
      });
      toast("태그 저장됨");
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.querySelectorAll("[data-rm-tag]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.removeTag(sb, btn.getAttribute("data-rm-tag"));
        toast("태그 제거됨");
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  if (!caps().canManagePipeline) return;

  document.getElementById("btn-schedule")?.addEventListener("click", async () => {
    const local = document.getElementById("iv-at").value;
    if (!local) return toast("면접 일시를 입력하세요", true);
    try {
      await api.scheduleInterview(sb, {
        candidateId,
        applicationId: r.id,
        interviewAt: new Date(local).toISOString(),
        interviewer: document.getElementById("iv-who").value,
        meetingType: document.getElementById("iv-type").value,
        note: document.getElementById("iv-note").value,
        staffId: staff.id,
      });
      toast("면접 일정 등록");
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-iv-result")?.addEventListener("click", async (ev) => {
    try {
      await api.updateInterviewResult(sb, {
        interviewId: ev.currentTarget.getAttribute("data-ivid"),
        result: document.getElementById("iv-result").value,
        hiredStartDate: document.getElementById("iv-hired").value || undefined,
        note: document.getElementById("iv-note")?.value,
        staffId: staff.id,
      });
      toast("면접 결과 반영");
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-stage")?.addEventListener("click", async () => {
    try {
      await api.setApplicationStage(sb, {
        applicationId: r.id,
        candidateId,
        stage: document.getElementById("stage").value,
        reason: document.getElementById("stage-reason").value,
        staffId: staff.id,
      });
      toast("단계 저장");
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-block")?.addEventListener("click", async () => {
    if (!confirm("이 후보자를 블락할까요?")) return;
    try {
      await api.blockCandidate(sb, {
        candidateId,
        applicationId: r.id,
        reason: document.getElementById("stage-reason").value || "blocked via web",
        staffId: staff.id,
      });
      toast("블락 처리됨");
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

async function renderTalentDetail(pane) {
  const r = selected;
  const candidateId = r.candidate?.id;
  const meta = r.profile_meta || {};
  const name = r.candidate?.name || "(이름 없음)";

  const [tags, history, docs] = await Promise.all([
    api.listTags(sb, "talent_pool", r.id),
    candidateId ? api.listStatusHistory(sb, candidateId) : Promise.resolve([]),
    api.listDocuments(sb, { candidateId, talentPoolId: r.id }),
  ]);

  const headerBadges = [
    platformIcon(r.platform, { large: true }),
    `<span class="stage-pill">${esc(proposalLabel(r.proposal_status))}</span>`,
    isNew(r.sourced_at) ? `<span class="badge new">NEW</span>` : "",
    !r.is_active ? `<span class="badge blocked">블락</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const subBits = [r.headline, meta.genderAge, meta.careerText].filter(Boolean).map(esc).join(" · ");

  const profileHtml = [
    detailFacts([
      ["현재 회사", esc(meta.company || "—")],
      ["경력", esc(meta.careerText || "—")],
      ["수집일", esc(fmtDate(r.sourced_at))],
    ]),
    renderChips(meta.roles),
    renderChips(meta.skills),
    renderChips(meta.badges, "badge-chip"),
    detailSection(
      "서류",
      renderDocuments(docs),
      { icon: Icon.file({ size: 16 }) },
    ),
    detailSection(
      "프로필",
      renderProfileLinkRow(r.profile_url, docs),
      { icon: Icon.link({ size: 16 }) },
    ),
  ].join("");

  const docsHtml = `${
    caps().canRecommend
      ? `<div class="detail-actions">
          <button type="button" class="btn btn-primary" id="btn-recommend">추천하기</button>
          <span class="muted detail-hint">별명 <b>${esc(staff?.nickname || "")}</b></span>
        </div>`
      : `<p class="muted empty-inline">이력서·첨부파일은 상단 <b>서류</b> 섹션에서 열 수 있습니다.</p>`
  }`;

  const tagsHtml = `
    ${renderTagChips(tags, { canRemove: true })}
    ${
      caps().canTagExtra
        ? `<div class="stack tag-form">
        <select id="tag-type">
          ${Object.entries(TAG_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <input id="tag-comment" placeholder="코멘트" />
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-tag">태그 저장</button>
      </div>`
        : ""
    }`;

  const blockHtml = caps().canBlock
    ? detailSection(
        "블락",
        `<input id="block-reason" class="block-reason" placeholder="사유" />
      <div class="detail-actions">
        <button type="button" class="btn btn-danger btn-sm" id="btn-block-talent">인재 블락</button>
      </div>
      <ul class="timeline">
        ${
          history.length
            ? history
                .map(
                  (h) =>
                    `<li><b>${esc(h.status_code)}</b> · ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}</li>`,
                )
                .join("")
            : `<li class="muted">이력 없음</li>`
        }
      </ul>`,
        { icon: Icon.ban({ size: 16 }) },
      )
    : "";

  const body = [
    profileHtml,
    detailSection("추천", docsHtml, { icon: Icon.star({ size: 16 }) }),
    detailSection("추천 태그", tagsHtml, { icon: Icon.star({ size: 16 }) }),
    blockHtml,
  ].join("");

  pane.innerHTML = wrapDetail(name, subBits, body, { badges: headerBadges });

  document.getElementById("btn-recommend")?.addEventListener("click", async () => {
    try {
      await api.addTag(sb, {
        targetType: "talent_pool",
        targetId: r.id,
        tagType: "recommend",
        comment: "",
        staffId: staff.id,
      });
      toast(`${staff.nickname || "나"} 추천 등록`);
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-add-tag")?.addEventListener("click", async () => {
    try {
      await api.addTag(sb, {
        targetType: "talent_pool",
        targetId: r.id,
        tagType: document.getElementById("tag-type").value,
        comment: document.getElementById("tag-comment").value,
        staffId: staff.id,
      });
      toast("태그 저장됨");
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.querySelectorAll("[data-rm-tag]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.removeTag(sb, btn.getAttribute("data-rm-tag"));
        toast("태그 제거됨");
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
  document.getElementById("btn-block-talent")?.addEventListener("click", async () => {
    if (!confirm("이 인재검색 후보를 블락할까요?")) return;
    try {
      await api.blockTalent(sb, {
        talentId: r.id,
        candidateId,
        reason: document.getElementById("block-reason").value,
        staffId: staff.id,
      });
      toast("블락 처리됨");
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function bindCardSelection() {
  document.querySelectorAll(".candidate-card[data-id]").forEach((card) => {
    card.addEventListener("click", async () => {
      selected = rows.find((r) => r.id === card.getAttribute("data-id")) || null;
      document.querySelectorAll(".candidate-card").forEach((x) => x.classList.remove("selected"));
      card.classList.add("selected");
      try {
        if (tab === "postings" && selected) {
          selectedPostingApps = await api.listApplications(sb, {
            postingId: selected.id,
          });
        } else {
          selectedPostingApps = [];
        }
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
}

async function ensureTabData(force = false) {
  if (tab === "dashboard") {
    if (!force && cacheFresh(tabCache.dashboard)) {
      dashboardStats = tabCache.dashboard.stats;
      return;
    }
    dashboardStats = await api.getDashboardStats(sb);
    tabCache.dashboard = { stats: dashboardStats, at: Date.now() };
    return;
  }

  if (tab === "postings") {
    const hit = tabCache.postings;
    if (!force && cacheFresh(hit) && hit.q === filterQ) {
      rows = hit.rows;
      return;
    }
    rows = await api.listPostings(sb, { q: filterQ, limit: 500 });
    appDocFlags = new Map();
    tabCache.postings = { rows, q: filterQ, at: Date.now() };
    return;
  }

  if (tab === "applicants") {
    const hit = tabCache.applicants;
    if (!force && cacheFresh(hit) && hit.q === filterQ) {
      rows = hit.rows;
      postingNavRows = hit.postingNavRows;
      appDocFlags = hit.flags;
      return;
    }
    const [apps, postings, flags] = await Promise.all([
      api.listApplications(sb, { q: filterQ }),
      api.listPostings(sb, { limit: 500 }),
      api.listApplicationDocFlags(sb).catch(() => new Map()),
    ]);
    rows = apps;
    postingNavRows = postings;
    appDocFlags = flags;
    tabCache.applicants = {
      rows,
      postingNavRows,
      flags: appDocFlags,
      q: filterQ,
      at: Date.now(),
    };
    // postings 목록 캐시도 갱신
    if (!filterQ) tabCache.postings = { rows: postings, q: "", at: Date.now() };
    return;
  }

  // talent — 전체 로드 후 클라이언트에서 플랫폼/분야 필터
  const hit = tabCache.talent;
  if (!force && cacheFresh(hit) && hit.q === filterQ) {
    rows = hit.rows;
    return;
  }
  rows = await api.listTalents(sb, { q: filterQ, platform: "", limit: 500 });
  appDocFlags = new Map();
  tabCache.talent = { rows, q: filterQ, platform: "", at: Date.now() };
}

function paintNavActive() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
}

function ensureSplitMain() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("main-full");
  if (!document.getElementById("detail-pane")) {
    main.insertAdjacentHTML(
      "beforeend",
      `<div class="detail-backdrop" id="detail-backdrop"></div>
       <aside class="detail-pane" id="detail-pane"></aside>`,
    );
    document.getElementById("detail-backdrop")?.addEventListener("click", () => closeDetailDrawer());
  }
}

async function switchTab(next) {
  const prev = tab;
  tab = next;
  selected = null;
  selectedPostingApps = [];
  destroyPostingStageChart();
  resetListFilters();
  syncHashFromTab();

  const shellExists = Boolean(document.querySelector(".app-shell"));
  const stayInList =
    shellExists && prev !== "dashboard" && next !== "dashboard";

  await ensureTabData(false);
  clampListPage();

  if (stayInList) {
    paintNavActive();
    ensureSplitMain();
    paintListPane();
    const pane = document.getElementById("detail-pane");
    if (pane) {
      pane.classList.remove("is-open");
      pane.innerHTML = "";
    }
    document.getElementById("detail-backdrop")?.classList.remove("is-open");
    return;
  }

  await refresh(true, { skipFetch: true });
}

async function refresh(resetSelection = true, { skipFetch = false, forceFetch = false } = {}) {
  if (resetSelection) {
    selected = null;
    listPage = 1;
  }
  const keepId = selected?.id;
  syncHashFromTab();

  if (!skipFetch) await ensureTabData(forceFetch);

  if (tab === "dashboard") {
    destroyDashCharts();
    shell(renderDashboard(), "", { fullWidth: true });
    bindListChrome();
    mountDashboardCharts();
    document.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await switchTab(btn.getAttribute("data-jump"));
      });
    });
    document.querySelectorAll("[data-goto-app]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        resetListFilters();
        tab = "applicants";
        syncHashFromTab();
        await ensureTabData(false);
        selected = rows.find((r) => r.id === btn.getAttribute("data-goto-app")) || null;
        shell(listContentHtml(), "");
        bindListChrome();
        bindPagination();
        bindCardSelection();
        bindTalentCategoryNav();
        bindPostingStatusNav();
        bindApplicantSideNav();
        if (selected) {
          syncListPageForSelection();
          paintListPane();
          await renderDetail();
        }
      });
    });
    return;
  }

  destroyDashCharts();

  if (keepId) selected = rows.find((r) => r.id === keepId) || null;
  if (selected) syncListPageForSelection();
  clampListPage();

  if (tab === "postings" && selected) {
    selectedPostingApps = await api.listApplications(sb, {
      postingId: selected.id,
    });
  } else if (tab !== "postings") {
    selectedPostingApps = [];
  }

  shell(listContentHtml(), "");
  bindListChrome();
  bindPagination();
  bindCardSelection();
  bindTalentCategoryNav();
  bindPostingStatusNav();
  bindApplicantSideNav();

  if (selected) {
    try {
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  } else {
    await renderDetail();
  }
}

async function bootApp() {
  staff = await api.getMyStaff(sb);
  const fromHash = tabFromHash();
  if (fromHash) tab = fromHash;
  else syncHashFromTab();
  await refresh(true);

  window.addEventListener("hashchange", async () => {
    const next = tabFromHash();
    if (!next || next === tab) return;
    await switchTab(next);
  });
}

async function main() {
  if (!configReady()) {
    renderConfigMissing();
    return;
  }
  try {
    sb = createClient();
  } catch (e) {
    renderConfigMissing();
    return;
  }

  const session = await api.getSession(sb);
  if (!session) {
    renderLogin();
    return;
  }
  await bootApp();

  sb.auth.onAuthStateChange((_event, sess) => {
    if (!sess) renderLogin();
  });
}

main().catch((err) => {
  appEl.innerHTML = `<div class="login-shell"><div class="err">${esc(err.message || err)}</div></div>`;
});
