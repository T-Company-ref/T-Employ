import { configReady, createClient } from "./client.js?v=20260723e";
import * as api from "./api.js?v=20260723e";
import { Icon } from "./icons.js?v=20260723e";
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
} from "./labels.js?v=20260723e";
import {
  JOB_CATEGORIES,
  resolveTalentCategory,
  categoryShort,
} from "./categories.js?v=20260723e";

const appEl = document.getElementById("app");

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
/** 지원자 사이드용 공고 캐시 */
let postingNavRows = [];
/** 공고 선택 시 하단 지원자 */
let selectedPostingApps = [];
let listPage = 1;
const PAGE_SIZE = 10;
let toastTimer = null;
let dashboardStats = null;

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
  if (!resume && !atts.length) {
    return `<p class="muted empty-inline">저장된 이력서·첨부파일이 없습니다.</p>`;
  }

  const resumeBlock = resume
    ? `<div class="doc-block">
        <div class="doc-block-label">이력서</div>
        <a class="pdf-open-btn" href="${esc(resume.file_url)}" target="_blank" rel="noopener" title="이력서 PDF 열기">
          ${Icon.file({ size: 18, className: "pdf-open-icon" })}
          <span class="pdf-open-label">이력서 PDF 열기</span>
          ${Icon.external({ size: 13, className: "pdf-open-ext" })}
        </a>
        ${
          resume.collected_at
            ? `<p class="doc-meta muted">${esc(new Date(resume.collected_at).toLocaleDateString("ko-KR"))} 수집</p>`
            : ""
        }
        ${
          selected?.profile_meta?.resumeLastModified
            ? `<p class="doc-meta muted">이 이력서는 ${esc(
                fmtResumeLastModified(selected.profile_meta.resumeLastModified),
              )}에 최종 수정된 이력서입니다.</p>`
            : ""
        }
      </div>`
    : `<div class="doc-block">
        <div class="doc-block-label">이력서</div>
        <span class="pdf-open-btn is-disabled" title="PDF 없음">
          ${Icon.file({ size: 18, className: "pdf-open-icon" })}
          <span class="pdf-open-label">이력서 PDF 없음</span>
        </span>
      </div>`;

  const attBlock = `<div class="doc-block">
      <div class="doc-block-label">첨부파일${atts.length ? ` · ${atts.length}` : ""}</div>
      ${
        atts.length
          ? `<ul class="doc-attach-list">${atts
              .map((d) => {
                const kind = d.source_label || (d.doc_type === "portfolio" ? "포트폴리오" : "첨부");
                const name = d.source_name || "첨부파일";
                return `<li>
                  <a class="attach-open-btn" href="${esc(d.file_url)}" target="_blank" rel="noopener" title="${esc(name)} 열기">
                    <span class="attach-kind">${esc(kind)}</span>
                    <span class="attach-name">${esc(name)}</span>
                    <span class="attach-action">열기 ${Icon.external({ size: 13, className: "inline-icon" })}</span>
                  </a>
                </li>`;
              })
              .join("")}</ul>`
          : `<p class="muted empty-inline">첨부파일 없음</p>`
      }
    </div>`;

  return `<div class="doc-panel">${resumeBlock}${attBlock}</div>`;
}

function renderProfileLinkRow(profileUrl, docs, { label = "잡코리아 프로필", listMode = false } = {}) {
  const profileLink = profileUrl
    ? `<a class="profile-origin-link" href="${esc(profileUrl)}" target="_blank" rel="noopener">${esc(label)} ${Icon.external({ size: 14, className: "inline-icon" })}</a>`
    : `<span class="muted">${listMode ? "공고 지원자 목록 링크 없음" : "프로필 링크 없음"}</span>`;
  return `<div class="profile-link-row">${profileLink}</div>`;
}

function applicantListUrl(r) {
  const gi = r?.posting?.external_posting_id;
  if (r?.platform === "jobkorea" && gi) {
    return `https://www.jobkorea.co.kr/Corp/Applicant/list?GI_No=${encodeURIComponent(gi)}&PageCode=YA`;
  }
  return r?.posting?.meta?.applicantListUrl || null;
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

function shell(innerList, innerDetail, { fullWidth = false } = {}) {
  const who = staff?.display_name || staff?.email || "—";
  const role = roleLabel(staff?.role);
  const nick = staff?.nickname ? `@${staff.nickname}` : "";
  const tabs = [
    ["dashboard", "대시보드"],
    ["postings", "공고"],
    ["applicants", "지원자"],
    ["talent", "인재검색"],
  ];
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
      tab = btn.getAttribute("data-tab");
      selected = null;
      filterCategory = "all";
      filterPostingStatus = "open";
      filterApplicantPostingId = "";
      selectedPostingApps = [];
      listPage = 1;
      await refresh();
    });
  });
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await api.signOut(sb);
    staff = null;
    renderLogin();
  });
  document.getElementById("btn-profile")?.addEventListener("click", () => openProfileSettings());
  document.getElementById("detail-backdrop")?.addEventListener("click", () => closeDetailDrawer());
}

function isCompactLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function openDetailDrawer() {
  document.getElementById("detail-pane")?.classList.add("is-open");
  document.getElementById("detail-backdrop")?.classList.add("is-open");
  if (isCompactLayout()) document.body.style.overflow = "hidden";
}

function closeDetailDrawer() {
  selected = null;
  document.getElementById("detail-pane")?.classList.remove("is-open");
  document.getElementById("detail-backdrop")?.classList.remove("is-open");
  document.body.style.overflow = "";
  document.querySelectorAll(".candidate-card.selected").forEach((x) => x.classList.remove("selected"));
  const pane = document.getElementById("detail-pane");
  if (pane) {
    pane.innerHTML = `<div class="empty detail-empty">목록에서 항목을 선택하세요.</div>`;
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
  return `
    <div class="toolbar">
      <h2>${esc(title)}</h2>
      <input class="search" id="q" placeholder="검색…" value="${esc(filterQ)}" />
      ${
        showPlatform
          ? `<select class="select" id="platform">
        <option value="">전체 플랫폼</option>
        <option value="jobkorea" ${filterPlatform === "jobkorea" ? "selected" : ""}>잡코리아</option>
        <option value="saramin" ${filterPlatform === "saramin" ? "selected" : ""}>사람인</option>
      </select>`
          : ""
      }
      <button type="button" class="btn btn-ghost btn-sm" id="btn-refresh">새로고침</button>
    </div>`;
}

function bindListChrome() {
  document.getElementById("btn-refresh")?.addEventListener("click", () => refresh(false));
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
    return list;
  }
  if (tab !== "talent" || filterCategory === "all") return rows;
  return rows.filter((r) => resolveTalentCategory(r) === filterCategory);
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
  return tab === "postings" ? "채용 공고" : tab === "applicants" ? "공고 지원자" : "인재검색";
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
  const counts = Object.fromEntries(JOB_CATEGORIES.map((c) => [c.id, 0]));
  counts.all = rows.length;
  for (const r of rows) {
    const id = resolveTalentCategory(r);
    counts[id] = (counts[id] || 0) + 1;
  }
  return `<nav class="cat-side" aria-label="인재 카테고리">
    ${JOB_CATEGORIES.map((c) => {
      const n = counts[c.id] ?? 0;
      return `<button type="button" class="cat-side-btn ${filterCategory === c.id ? "active" : ""}" data-cat="${c.id}">
        <span class="cat-side-label">${esc(c.short)}</span>
        <span class="cat-side-count">${n}</span>
      </button>`;
    }).join("")}
  </nav>`;
}

function platformSideButtons(status) {
  const inStatus = (r) =>
    status === "closed" ? isPostingClosed(r) : !isPostingClosed(r);
  const base =
    tab === "applicants"
      ? rows.filter((r) => {
          const closed = isPostingClosed(r.posting || {});
          return status === "closed" ? closed : !closed;
        })
      : rows.filter(inStatus);
  const platOf = (r) => (tab === "applicants" ? r.platform || r.posting?.platform : r.platform);
  const allN = base.length;
  const jkN = base.filter((r) => platOf(r) === "jobkorea").length;
  const srN = base.filter((r) => platOf(r) === "saramin").length;
  const active = filterPostingStatus === status;
  return `
    <div class="cat-side-group ${active ? "" : "is-collapsed"}">
      <div class="cat-side-heading">플랫폼</div>
      <button type="button" class="cat-side-btn sub ${active && !filterPlatformSide ? "active" : ""}" data-pstatus="${status}" data-platform="">
        <span class="cat-side-label">전체</span>
        <span class="cat-side-count">${allN}</span>
      </button>
      <button type="button" class="cat-side-btn sub ${active && filterPlatformSide === "jobkorea" ? "active" : ""}" data-pstatus="${status}" data-platform="jobkorea">
        <span class="cat-side-label">잡코리아</span>
        <span class="cat-side-count">${jkN}</span>
      </button>
      <button type="button" class="cat-side-btn sub ${active && filterPlatformSide === "saramin" ? "active" : ""}" data-pstatus="${status}" data-platform="saramin">
        <span class="cat-side-label">사람인</span>
        <span class="cat-side-count">${srN}</span>
      </button>
    </div>`;
}

function postingStatusNav() {
  if (tab !== "postings") return "";
  const openN = rows.filter((r) => !isPostingClosed(r)).length;
  const closedN = rows.filter((r) => isPostingClosed(r)).length;
  return `<nav class="cat-side" aria-label="공고 상태">
    <button type="button" class="cat-side-btn ${filterPostingStatus === "open" ? "active" : ""}" data-pstatus="open">
      <span class="cat-side-label">${esc(POSTING_STATUS_SIDE.open)}</span>
      <span class="cat-side-count">${openN}</span>
    </button>
    ${platformSideButtons("open")}
    <button type="button" class="cat-side-btn ${filterPostingStatus === "closed" ? "active" : ""}" data-pstatus="closed">
      <span class="cat-side-label">${esc(POSTING_STATUS_SIDE.closed)}</span>
      <span class="cat-side-count">${closedN}</span>
    </button>
    ${platformSideButtons("closed")}
  </nav>`;
}

function applicantSideNav() {
  if (tab !== "applicants") return "";
  const openPostings = postingNavRows.filter((p) => {
    if (isPostingClosed(p)) return false;
    return !filterPlatformSide || p.platform === filterPlatformSide;
  });
  const closedPostings = postingNavRows.filter((p) => {
    if (!isPostingClosed(p)) return false;
    return !filterPlatformSide || p.platform === filterPlatformSide;
  });
  const statusPostings = filterPostingStatus === "closed" ? closedPostings : openPostings;
  const openAppN = rows.filter((r) => !isPostingClosed(r.posting || {})).length;
  const closedAppN = rows.filter((r) => isPostingClosed(r.posting || {})).length;

  const visibleForStatus = rows.filter((r) => {
    const closed = isPostingClosed(r.posting || {});
    const statusOk = filterPostingStatus === "closed" ? closed : !closed;
    const platformOk =
      !filterPlatformSide || (r.platform || r.posting?.platform) === filterPlatformSide;
    return statusOk && platformOk;
  });

  return `<nav class="cat-side" aria-label="지원자 공고 필터">
    <button type="button" class="cat-side-btn ${filterPostingStatus === "open" ? "active" : ""}" data-pstatus="open">
      <span class="cat-side-label">${esc(POSTING_STATUS_SIDE.open)}</span>
      <span class="cat-side-count">${openAppN}</span>
    </button>
    ${platformSideButtons("open")}
    <button type="button" class="cat-side-btn ${filterPostingStatus === "closed" ? "active" : ""}" data-pstatus="closed">
      <span class="cat-side-label">${esc(POSTING_STATUS_SIDE.closed)}</span>
      <span class="cat-side-count">${closedAppN}</span>
    </button>
    ${platformSideButtons("closed")}
    <div class="cat-side-group">
      <div class="cat-side-heading">공고별</div>
      <button type="button" class="cat-side-btn sub ${!filterApplicantPostingId ? "active" : ""}" data-app-posting="">
        <span class="cat-side-label">전체</span>
        <span class="cat-side-count">${visibleForStatus.length}</span>
      </button>
      ${statusPostings
        .map((p) => {
          const n = rows.filter((r) => (r.posting?.id || r.posting_id) === p.id).length;
          return `<button type="button" class="cat-side-btn sub ${
            filterApplicantPostingId === p.id ? "active" : ""
          }" data-app-posting="${esc(p.id)}" title="${esc(p.title || "")}">
            <span class="cat-side-label">${esc(p.title || "(제목 없음)")}</span>
            <span class="cat-side-count">${n}</span>
          </button>`;
        })
        .join("")}
    </div>
  </nav>`;
}

function renderPostingApplicantsInDetail() {
  const blocked = selected?.meta?.applicantAccessBlocked;
  const liveTotal = selected?.meta?.applicantCounts
    ? Object.entries(selected.meta.applicantCounts).find(([k]) => k.includes("전체"))?.[1]
    : null;
  if (!selectedPostingApps.length) {
    const emptyMsg = blocked
      ? `잡코리아 정책상 최근 90일 이내 공고만 지원자 상세를 열 수 있습니다.${
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
  document.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.getAttribute("data-cat") || "all";
      if (next === filterCategory) return;
      filterCategory = next;
      listPage = 1;
      selected = null;
      paintListPane();
      await renderDetail();
    });
  });
}

function bindPostingStatusNav() {
  document.querySelectorAll("[data-pstatus]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.getAttribute("data-pstatus") || "open";
      const platformAttr = btn.getAttribute("data-platform");
      const isPlatformBtn = platformAttr !== null;
      const nextPlatform = isPlatformBtn ? platformAttr : filterPlatformSide;

      if (next === filterPostingStatus && (!isPlatformBtn || nextPlatform === filterPlatformSide)) {
        return;
      }
      filterPostingStatus = next;
      if (isPlatformBtn) filterPlatformSide = nextPlatform;
      filterApplicantPostingId = "";
      listPage = 1;
      selected = null;
      selectedPostingApps = [];
      paintListPane();
      await renderDetail();
    });
  });
}

function bindApplicantSideNav() {
  document.querySelectorAll("[data-app-posting]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.getAttribute("data-app-posting") || "";
      if (next === filterApplicantPostingId) return;
      filterApplicantPostingId = next;
      listPage = 1;
      selected = null;
      paintListPane();
      await renderDetail();
    });
  });
}

function bindPostingAppsBelow() {
  document.querySelectorAll("[data-goto-app]").forEach((card) => {
    card.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = card.getAttribute("data-goto-app");
      const posting = selected;
      tab = "applicants";
      filterPostingStatus = posting && isPostingClosed(posting) ? "closed" : "open";
      filterApplicantPostingId = posting?.id || "";
      filterQ = "";
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
      document.getElementById("btn-refresh")?.addEventListener("click", () => refresh(false));
      document.querySelectorAll("[data-jump]").forEach((b) => {
        b.addEventListener("click", async () => {
          tab = b.getAttribute("data-jump");
          selected = null;
          await refresh();
        });
      });
      document.querySelectorAll("[data-goto-app]").forEach((b) => {
        b.addEventListener("click", async () => {
          tab = "applicants";
          filterQ = "";
          await refresh(true);
          selected = rows.find((r) => r.id === b.getAttribute("data-goto-app")) || null;
          if (selected) {
            document
              .querySelector(`.candidate-card[data-id="${selected.id}"]`)
              ?.classList.add("selected");
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
  return `<div class="card-list">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.meta || {};
      return `<article class="candidate-card ${sel}" data-id="${esc(r.id)}">
        <div class="card-name-row">
          <span class="card-name">${esc(r.title || "(제목 없음)")}</span>
          ${meta.status ? `<span class="badge">${esc(meta.status)}</span>` : ""}
        </div>
        <div class="card-meta-row">
          <span class="meta-pill platform" title="${esc(platformLabel(r.platform))}">${platformIcon(r.platform)}</span>
          <span class="meta-pill">${esc(meta.postingNumber || r.external_posting_id || "—")}</span>
          <span class="meta-pill stage">지원 ${r.applicant_count ?? 0}명</span>
        </div>
        <div class="card-footer">
          <span class="muted">${esc(meta.manager || "담당자 —")}${meta.period ? ` · ${esc(meta.period)}` : ""}</span>
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
  return `<div class="card-list">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.profile_meta || {};
      const postingMeta = r.posting?.meta || {};
      const name = r.candidate?.name || "(이름 없음)";
      const posting = r.posting?.title || "공고명 미수집";
      const postingNo = postingMeta.postingNumber ? ` · ${postingMeta.postingNumber}` : "";
      const badges = [
        isNew(r.created_at || r.applied_at) ? `<span class="badge new">NEW</span>` : "",
        !r.is_active || !r.candidate?.is_active ? `<span class="badge blocked">블락</span>` : "",
        meta.platformStatus ? `<span class="badge">${esc(meta.platformStatus)}</span>` : "",
      ].join(" ");
      const subParts = [meta.genderAge, meta.careerTotal].filter(Boolean);
      const edu = [meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" · ");

      return `<article class="candidate-card ${sel}" data-id="${esc(r.id)}">
        <div class="card-top">
          <div class="card-top-main">
            ${meta.position ? `<p class="card-headline">${esc(meta.position)}</p>` : ""}
            <div class="card-name-row">
              <span class="card-name">${esc(name)}</span>
              ${badges}
            </div>
            ${subParts.length ? `<div class="card-sub">${esc(subParts.join(" · "))}</div>` : ""}
          </div>
          <div class="card-top-side">
            ${meta.desiredSalary ? `<span class="card-salary">${esc(meta.desiredSalary)}</span>` : ""}
            <span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span>
          </div>
        </div>
        <div class="card-meta-row">
          <span class="meta-pill platform" title="${esc(platformLabel(r.platform))}">${platformIcon(r.platform)}</span>
        </div>
        ${renderChips(meta.recommendTags, "badge-chip")}
        ${edu ? `<div class="card-sub">${esc(edu)}</div>` : ""}
        ${renderChips(meta.careerHistory?.slice(0, 3))}
        <div class="card-footer">
          <span class="card-posting">${esc(posting)}${esc(postingNo)}</span>
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
    pane.classList.remove("is-open");
    document.getElementById("detail-backdrop")?.classList.remove("is-open");
    document.body.style.overflow = "";
    pane.innerHTML = `<div class="empty detail-empty">목록에서 항목을 선택하세요.</div>`;
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
    ? Object.entries(meta.applicantCounts).find(([k]) => k.includes("전체"))?.[1]
    : null;
  const body = `
    ${detailSection(
      "공고 정보",
      infoRows([
        ["공고번호", esc(meta.postingNumber || r.external_posting_id || "—")],
        ["상태", esc(meta.status || (isPostingClosed(r) ? "마감" : "진행 중"))],
        ["담당자", esc(meta.manager || "—")],
        ["기간", esc(meta.period || "—")],
        [
          "지원자",
          `${selectedPostingApps.length || r.applicant_count || 0}명 수집${
            liveTotal != null ? ` · 잡코리아 전체 ${liveTotal}명` : ""
          }`,
        ],
        [
          "원본 링크",
          r.source_url
            ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(platformLabel(r.platform))}에서 보기 ${Icon.external({ size: 13, className: "inline-icon" })}</a>`
            : "—",
        ],
      ]),
      { icon: Icon.clipboard({ size: 16 }) },
    )}
    <div class="detail-actions">
      <button type="button" class="btn btn-primary btn-sm" id="btn-view-apps">지원자 탭에서 보기</button>
    </div>
    ${renderPostingApplicantsInDetail()}`;

  pane.innerHTML = wrapDetail(r.title || "(제목 없음)", "", body, {
    badges: `${platformIcon(r.platform, { large: true })}`,
  });

  document.getElementById("btn-view-apps")?.addEventListener("click", async () => {
    tab = "applicants";
    filterPostingStatus = isPostingClosed(r) ? "closed" : "open";
    filterApplicantPostingId = r.id;
    filterQ = "";
    selected = null;
    await refresh();
  });
  bindPostingAppsBelow();
}

async function renderApplicantDetail(pane) {
  const r = selected;
  const candidateId = r.candidate?.id;
  const meta = r.profile_meta || {};
  const postingMeta = r.posting?.meta || {};
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

  const highlightHtml = detailFacts([
    ["희망연봉", esc(meta.desiredSalary || "—")],
    ["경력", esc(meta.careerTotal || "—")],
    ["학력", esc(edu || "—")],
    ["지원일", esc(fmtDate(r.applied_at))],
    ["수집일", esc(fmtDate(r.created_at))],
    [
      "이력서 최종 수정일",
      meta.resumeLastModified
        ? esc(fmtResumeLastModified(meta.resumeLastModified))
        : "—",
    ],
  ]);

  const profileHtml = [
    highlightHtml,
    meta.recommendTags?.length ? renderChips(meta.recommendTags, "badge-chip") : "",
    meta.careerHistory?.length ? renderChips(meta.careerHistory) : "",
    detailSection(
      "연락처",
      infoRows([["이메일", esc(r.candidate?.email || "—")]]),
      { icon: Icon.phone({ size: 16 }) },
    ),
    detailSection(
      "서류",
      renderDocuments(docs),
      { icon: Icon.file({ size: 16 }) },
    ),
    detailSection(
      "프로필",
      renderProfileLinkRow(applicantListUrl(r), docs, { label: "잡코리아 지원자 목록", listMode: true }),
      { icon: Icon.link({ size: 16 }) },
    ),
    detailSection(
      "공고",
      infoRows([
        ["공고명", esc(r.posting?.title || "공고명 미수집")],
        ["공고번호", esc(postingMeta.postingNumber || r.posting?.external_posting_id || "—")],
        ["담당자", esc(postingMeta.manager || "—")],
        [
          "공고 보기",
          r.posting?.source_url
            ? `<a href="${esc(r.posting.source_url)}" target="_blank" rel="noopener">잡코리아 공고 ${Icon.external({ size: 13, className: "inline-icon" })}</a>`
            : "—",
        ],
      ]),
      { icon: Icon.clipboard({ size: 16 }) },
    ),
  ].join("");

  const docsHtml = `${
    caps().canRecommend
      ? `<div class="detail-actions">
          <button type="button" class="btn btn-primary" id="btn-recommend">추천하기</button>
          <span class="muted detail-hint">별명 <b>${esc(staff?.nickname || "")}</b>으로 표시</span>
        </div>`
      : `<p class="muted empty-inline">이력서·첨부파일은 상단 <b>서류</b> 섹션에서 열 수 있습니다.</p>`
  }`;

  const tagsHtml = `
    ${renderTagChips(tags, { canRemove: true })}
    ${
      caps().canTagExtra
        ? `<div class="stack tag-form">
        <label>기타 태그</label>
        <select id="tag-type">
          ${Object.entries(TAG_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <input id="tag-comment" placeholder="코멘트 (선택)" />
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-tag">태그 저장</button>
      </div>`
        : ""
    }`;

  const pipelineHtml = caps().canManagePipeline
    ? `${detailSection(
        "면접",
        `<ul class="timeline">
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
            : `<li class="muted">일정 없음</li>`
        }
      </ul>
      <div class="stack form-block">
        <label>면접 일정 등록</label>
        <input id="iv-at" type="datetime-local" />
        <input id="iv-who" placeholder="면접관" />
        <select id="iv-type">
          ${Object.entries(MEETING_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <textarea id="iv-note" placeholder="메모"></textarea>
        <button type="button" class="btn btn-primary btn-sm" id="btn-schedule">일정 저장</button>
      </div>
      ${
        interviews[0]
          ? `<div class="stack form-block">
              <label>최근 면접 결과</label>
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
      }`,
        { icon: Icon.calendar({ size: 16 }) },
      )}
      ${detailSection(
        "상태 변경",
        `<div class="stack form-block">
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
            : `<li class="muted">이력 없음</li>`
        }
      </ul>`,
        { icon: Icon.chart({ size: 16 }) },
      )}`
    : detailSection(
        "상태 이력",
        `<p class="stage-readonly">현재 단계: <strong>${esc(stageLabel(r.current_stage))}</strong></p>
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
      </ul>`,
        { icon: Icon.chart({ size: 16 }) },
      );

  const body = [
    profileHtml,
    detailSection("추천", docsHtml, { icon: Icon.star({ size: 16 }) }),
    detailSection("추천 태그", tagsHtml, { icon: Icon.star({ size: 16 }) }),
    pipelineHtml,
  ].join("");

  pane.innerHTML = wrapDetail(name, subBits, body, { badges: headerBadges });

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

async function refresh(resetSelection = true) {
  if (resetSelection) {
    selected = null;
    listPage = 1;
  }
  const keepId = selected?.id;

  if (tab === "dashboard") {
    destroyDashCharts();
    dashboardStats = await api.getDashboardStats(sb);
    shell(renderDashboard(), "", { fullWidth: true });
    bindListChrome();
    mountDashboardCharts();
    document.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        tab = btn.getAttribute("data-jump");
        selected = null;
        await refresh();
      });
    });
    document.querySelectorAll("[data-goto-app]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        tab = "applicants";
        filterQ = "";
        await refresh(true);
        selected = rows.find((r) => r.id === btn.getAttribute("data-goto-app")) || null;
        if (selected) {
          document
            .querySelector(`.candidate-card[data-id="${selected.id}"]`)
            ?.classList.add("selected");
          await renderDetail();
        }
      });
    });
    return;
  }

  destroyDashCharts();

  if (tab === "postings") {
    rows = await api.listPostings(sb, { q: filterQ, limit: 500 });
  } else if (tab === "applicants") {
    const [apps, postings] = await Promise.all([
      api.listApplications(sb, { q: filterQ }),
      api.listPostings(sb, { limit: 500 }),
    ]);
    rows = apps;
    postingNavRows = postings;
  } else {
    rows = await api.listTalents(sb, { q: filterQ, platform: filterPlatform, limit: 500 });
  }

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

  shell(
    listContentHtml(),
    `<div class="empty detail-empty">목록에서 항목을 선택하세요.</div>`,
  );
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
  await refresh(true);
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
