import { configReady, createClient } from "./client.js?v=20260723d";
import * as api from "./api.js?v=20260723d";
import { Icon } from "./icons.js?v=20260723d";
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
} from "./labels.js?v=20260723d";
import {
  JOB_CATEGORIES,
  resolveTalentCategory,
  categoryShort,
} from "./categories.js?v=20260723d";

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
/** @type {'open'|'closed'} ??�???? ???????: ?? ??*/
let filterPostingStatus = "open";
/** ??�????: ???????? (??????= ???) */
let filterPlatformSide = "";
/** ???? ?? ??? ????(??????= ??? ??? ???) */
let filterApplicantPostingId = "";
/** ???? ?????? ?? ?? */
let postingNavRows = [];
/** ?? ??? ????? ???? */
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
  if (/??|??|closed|???|?????/i.test(s)) return true;
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
  const wd = ["??, "??, "??, "??, "??, "??, "??][d.getDay()];
  return `${m[1]}??${Number(m[2])}??${Number(m[3])}??(${wd})`;
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
  if (!iso) return "??;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??;
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
    return `<p class="muted empty-inline">????? ?????�?????????????.</p>`;
  }

  const resumeBlock = resume
    ? `<div class="doc-block">
        <div class="doc-block-label">?????/div>
        <a class="pdf-open-btn" href="${esc(resume.file_url)}" target="_blank" rel="noopener" title="?????PDF ???">
          ${Icon.file({ size: 18, className: "pdf-open-icon" })}
          <span class="pdf-open-label">?????PDF ???</span>
          ${Icon.external({ size: 13, className: "pdf-open-ext" })}
        </a>
        ${
          resume.collected_at
            ? `<p class="doc-meta muted">${esc(new Date(resume.collected_at).toLocaleDateString("ko-KR"))} ???</p>`
            : ""
        }
        ${
          selected?.profile_meta?.resumeLastModified
            ? `<p class="doc-meta muted">???????? ${esc(
                fmtResumeLastModified(selected.profile_meta.resumeLastModified),
              )}???? ??????????????.</p>`
            : ""
        }
      </div>`
    : `<div class="doc-block">
        <div class="doc-block-label">?????/div>
        <span class="pdf-open-btn is-disabled" title="PDF ???">
          ${Icon.file({ size: 18, className: "pdf-open-icon" })}
          <span class="pdf-open-label">?????PDF ???</span>
        </span>
      </div>`;

  const attBlock = `<div class="doc-block">
      <div class="doc-block-label">??????${atts.length ? ` � ${atts.length}` : ""}</div>
      ${
        atts.length
          ? `<ul class="doc-attach-list">${atts
              .map((d) => {
                const kind = d.source_label || (d.doc_type === "portfolio" ? "???????? : "???");
                const name = d.source_name || "??????";
                return `<li>
                  <a class="attach-open-btn" href="${esc(d.file_url)}" target="_blank" rel="noopener" title="${esc(name)} ???">
                    <span class="attach-kind">${esc(kind)}</span>
                    <span class="attach-name">${esc(name)}</span>
                    <span class="attach-action">??? ${Icon.external({ size: 13, className: "inline-icon" })}</span>
                  </a>
                </li>`;
              })
              .join("")}</ul>`
          : `<p class="muted empty-inline">?????? ???</p>`
      }
    </div>`;

  return `<div class="doc-panel">${resumeBlock}${attBlock}</div>`;
}

function renderProfileLinkRow(profileUrl, docs, { label = "????? ?????, listMode = false } = {}) {
  const profileLink = profileUrl
    ? `<a class="profile-origin-link" href="${esc(profileUrl)}" target="_blank" rel="noopener">${esc(label)} ${Icon.external({ size: 14, className: "inline-icon" })}</a>`
    : `<span class="muted">${listMode ? "?? ???? ?? ?? ???" : "??????? ???"}</span>`;
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
        <strong>Supabase ???????????.</strong>
        <p style="margin:8px 0 0">??: <code>web/config.example.js</code> ??<code>web/config.js</code> ?? ??
        <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> ???.</p>
      </div>
    </div>`;
}

function renderLogin(errorMsg = "") {
  appEl.innerHTML = `
    <div class="login-shell">
      <form class="login-card" id="login-form">
        <h1 class="brand">TBELL <span>Employ</span></h1>
        <p class="sub">???????? ?? ?????? ????????.</p>
        <div class="field">
          <label for="email">?????/ ?????/label>
          <input id="email" name="email" type="text" autocomplete="username" required placeholder="tbelltest ??? name@tbell.co.kr" />
        </div>
        <div class="field">
          <label for="password">?????</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">????/button>
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
  const who = staff?.display_name || staff?.email || "??;
  const role = roleLabel(staff?.role);
  const nick = staff?.nickname ? `@${staff.nickname}` : "";
  const tabs = [
    ["dashboard", "???????],
    ["postings", "??"],
    ["applicants", "????"],
    ["talent", "??????],
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
          <button type="button" class="user-chip" id="btn-profile" title="?????�??????">
            <span class="user-name">${esc(who)}</span>
            <span class="user-meta">${esc([nick, role].filter(Boolean).join(" � "))}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-logout">?????</button>
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
    pane.innerHTML = `<div class="empty detail-empty">????? ??????????????</div>`;
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
      <button type="button" class="detail-close" id="btn-detail-close" aria-label="???">${Icon.close({ size: 18 })}</button>
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
  const rows = items.filter(([, v]) => v != null && v !== "" && v !== "??);
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
  const rows = entries.filter(([, v]) => v != null && v !== "" && v !== "??);
  if (!rows.length) return `<p class="muted">??? ???</p>`;
  return `<dl class="info-rows">${rows
    .map(([k, v]) => `<div class="info-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;
}

function renderTagChips(tags, { canRemove = false } = {}) {
  if (!tags.length) return `<p class="muted empty-inline">??? ??????????</p>`;
  return `<div class="chip-row tag-chips">${tags
    .map(
      (t) => `<span class="chip tag-chip">
        <span class="tag-type">${esc(label(TAG_LABELS, t.tag_type, t.tag_type))}</span>
        ${t.comment ? `<span class="tag-comment">${esc(t.comment)}</span>` : ""}
        <span class="tag-author">${esc(staffNick(t.staff))}</span>
        ${
          canRemove && caps().canRecommend && t.tagged_by === staff?.id
            ? `<button type="button" data-rm-tag="${esc(t.id)}" title="????? ???" class="icon-btn">${Icon.close({ size: 14 })}</button>`
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
  // ?? ????(?????�???�???? ??: ??�??? ???
  if (!staff || staff._unlinked || !staff.id) {
    toast("?? ?????? ??????? ???????? ?????? ???????", true);
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
    toast(e.message || "??? ??? ?? ???", true);
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
            <h3 id="profile-title" style="margin:0">?????</h3>
            <p class="muted" style="margin:4px 0 0">${esc(staff.email || "")} � ${esc(roleLabel(staff.role))}</p>
          </div>
          <button type="button" class="detail-close" id="pf-cancel" aria-label="???">${Icon.close({ size: 18 })}</button>
        </div>
        <div class="stack">
          <div class="pf-field">
            <label for="pf-display">??? ???</label>
            <input id="pf-display" value="${esc(staff.display_name || "")}" placeholder="?? ???? />
          </div>
          <div class="pf-field">
            <label for="pf-nick">?? (?? ????????)</label>
            <input id="pf-nick" value="${esc(staff.nickname || "")}" placeholder="?? yj.kim" />
          </div>
          <div class="pf-field">
            <label>?? ???</label>
            <div class="notify-checks">
              <label><input type="checkbox" id="pf-rt" ${rt ? "checked" : ""} /> ????????</label>
              <label><input type="checkbox" id="pf-dg" ${dg ? "checked" : ""} /> ?? ????????(07:30)</label>
            </div>
          </div>
          <div class="pf-field">
            <label>??? ?? ?? (?? ??� ???</label>
            <p class="pf-hint">??????? ??????? ???? ???????????????????. ??????? ?? ????</p>
            <div class="interest-list" id="pf-interest">
              ${
                openPostings.length
                  ? openPostings
                      .map(
                        (p) => `<label>
                          <input type="checkbox" data-pid="${esc(p.id)}" ${interested.has(p.id) ? "checked" : ""} />
                          <span>${esc(p.title || "(??? ???)")}
                            <span class="muted"> � ${esc(platformLabel(p.platform))}</span>
                          </span>
                        </label>`,
                      )
                      .join("")
                  : `<p class="muted">?? ????? ??????.</p>`
              }
            </div>
          </div>
        </div>
        <div class="actions" style="margin-top:16px">
          <button type="button" class="btn btn-primary btn-sm" id="pf-save" style="width:auto">????/button>
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
      if (!nickname) return toast("????????????, true);
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
      toast("??? ?????");
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
      <input class="search" id="q" placeholder="????? value="${esc(filterQ)}" />
      ${
        showPlatform
          ? `<select class="select" id="platform">
        <option value="">??? ?????/option>
        <option value="jobkorea" ${filterPlatform === "jobkorea" ? "selected" : ""}>?????</option>
        <option value="saramin" ${filterPlatform === "saramin" ? "selected" : ""}>?????/option>
      </select>`
          : ""
      }
      <button type="button" class="btn btn-ghost btn-sm" id="btn-refresh">?????</button>
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
  return tab === "postings" ? "?? ??" : tab === "applicants" ? "?? ????" : "??????;
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
  return `<nav class="list-pagination" aria-label="????">
    <button type="button" class="btn btn-ghost btn-sm page-nav" id="page-prev" ${listPage <= 1 ? "disabled" : ""}>???</button>
    <div class="page-nums">${pages.join("")}</div>
    <span class="page-info">${from}??{to} / ${list.length}</span>
    <button type="button" class="btn btn-ghost btn-sm page-nav" id="page-next" ${listPage >= total ? "disabled" : ""}>???</button>
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
  return `<nav class="cat-side" aria-label="??? ????">
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
      <div class="cat-side-heading">?????/div>
      <button type="button" class="cat-side-btn sub ${active && !filterPlatformSide ? "active" : ""}" data-pstatus="${status}" data-platform="">
        <span class="cat-side-label">???</span>
        <span class="cat-side-count">${allN}</span>
      </button>
      <button type="button" class="cat-side-btn sub ${active && filterPlatformSide === "jobkorea" ? "active" : ""}" data-pstatus="${status}" data-platform="jobkorea">
        <span class="cat-side-label">?????</span>
        <span class="cat-side-count">${jkN}</span>
      </button>
      <button type="button" class="cat-side-btn sub ${active && filterPlatformSide === "saramin" ? "active" : ""}" data-pstatus="${status}" data-platform="saramin">
        <span class="cat-side-label">?????/span>
        <span class="cat-side-count">${srN}</span>
      </button>
    </div>`;
}

function postingStatusNav() {
  if (tab !== "postings") return "";
  const openN = rows.filter((r) => !isPostingClosed(r)).length;
  const closedN = rows.filter((r) => isPostingClosed(r)).length;
  return `<nav class="cat-side" aria-label="?? ???">
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

  return `<nav class="cat-side" aria-label="???? ?? ???">
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
      <div class="cat-side-heading">????/div>
      <button type="button" class="cat-side-btn sub ${!filterApplicantPostingId ? "active" : ""}" data-app-posting="">
        <span class="cat-side-label">???</span>
        <span class="cat-side-count">${visibleForStatus.length}</span>
      </button>
      ${statusPostings
        .map((p) => {
          const n = rows.filter((r) => (r.posting?.id || r.posting_id) === p.id).length;
          return `<button type="button" class="cat-side-btn sub ${
            filterApplicantPostingId === p.id ? "active" : ""
          }" data-app-posting="${esc(p.id)}" title="${esc(p.title || "")}">
            <span class="cat-side-label">${esc(p.title || "(??? ???)")}</span>
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
    ? Object.entries(selected.meta.applicantCounts).find(([k]) => k.includes("???"))?.[1]
    : null;
  if (!selectedPostingApps.length) {
    const emptyMsg = blocked
      ? `????? ??????? 90????? ???????? ???????????????.${
          liveTotal != null ? ` ??????? ${liveTotal}??? ?????? ??? ????? ????????` : ""
        }`
      : "???????????????? ??????.";
    return `<div class="posting-apps-panel">
      <h3 class="section-title">???? ???? <span class="muted">0??/span></h3>
      <div class="empty">${esc(emptyMsg)}</div>
    </div>`;
  }
  return `<div class="posting-apps-panel">
    <h3 class="section-title">???? ???? <span class="muted">${selectedPostingApps.length}??{
      liveTotal != null ? ` / ??? ${liveTotal}` : ""
    }</span></h3>
    <div class="card-list detail-app-list">${selectedPostingApps
      .map((r) => {
        const meta = r.profile_meta || {};
        const name = r.candidate?.name || "(??? ???)";
        return `<article class="candidate-card" data-goto-app="${esc(r.id)}">
          <div class="card-name-row">
            <span class="card-name">${esc(name)}</span>
            ${isNew(r.created_at || r.applied_at) ? `<span class="badge new">NEW</span>` : ""}
            <span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span>
          </div>
          <div class="card-sub">${esc(
            [meta.genderAge, meta.careerTotal, meta.position].filter(Boolean).join(" � ") || "??,
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
        <td><b>${esc(r.candidate?.name || "(??? ???)")}</b></td>
        <td class="muted">${esc(r.posting?.title || "?? ????)}</td>
        <td><span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span></td>
        <td class="muted">${esc(fmtDate(r.applied_at))}</td>
      </tr>`,
    )
    .join("");

  const trendTitle = dashTrendMode === "talents" ? "??? ????????" : "??? ?????";

  return `
    <div class="dash-page">
      <div class="toolbar">
        <h2>???????/h2>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-refresh">?????</button>
      </div>
      <div class="dash-links">
        <a class="dash-link" href="https://www.jobkorea.co.kr/Corp/Main" target="_blank" rel="noopener">????? ????? ${Icon.external({ size: 13 })}</a>
        <a class="dash-link" href="https://www.saramin.co.kr/zf_user/memcom/main" target="_blank" rel="noopener">?????????? ${Icon.external({ size: 13 })}</a>
      </div>
      <div class="dash-kpis">
        <button type="button" class="dash-card" data-jump="applicants">
          <div class="dash-label">??? ????</div>
          <div class="dash-num">${s.applicantsYesterday ?? 0}</div>
          <div class="dash-sub muted">${esc(s.yesterdayLabel || "???")}</div>
        </button>
        <button type="button" class="dash-card" data-jump="applicants">
          <div class="dash-label">?????????</div>
          <div class="dash-num">${s.applicantsThisWeek ?? 0}</div>
          <div class="dash-sub muted">${esc(s.weekLabel || "??????)}</div>
        </button>
        <button type="button" class="dash-card" data-jump="talent">
          <div class="dash-label">??????/div>
          <div class="dash-num">${s.talents}</div>
          <div class="dash-sub muted">???</div>
        </button>
        <button type="button" class="dash-card" data-jump="postings">
          <div class="dash-label">??</div>
          <div class="dash-num">${s.postings}</div>
          <div class="dash-sub muted">???</div>
        </button>
      </div>
      <div class="dash-charts dash-charts-single">
        <div class="panel chart-panel chart-panel-wide">
          <div class="chart-head">
            <h3>${trendTitle} <span class="muted chart-sub">?? 14??/span></h3>
            <div class="chart-filters" role="group" aria-label="?? ???">
              <button type="button" class="chip-filter ${dashTrendMode === "apps" ? "active" : ""}" data-trend="apps">????</button>
              <button type="button" class="chip-filter ${dashTrendMode === "talents" ? "active" : ""}" data-trend="talents">??????/button>
            </div>
          </div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-trend-daily"></canvas></div>
        </div>
      </div>
      <div class="panel dash-recent">
        <h3>?? ????</h3>
        <div class="table-scroll">
          <table class="dash-table">
            <thead>
              <tr><th>???</th><th>??</th><th>???</th><th>????</th></tr>
            </thead>
            <tbody>${recent || `<tr><td colspan="4" class="muted">???</td></tr>`}</tbody>
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
            label: isTalent ? "???" : "???,
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
      filterPostingStatus === "closed" ? "??????? ??????." : "?? ????? ??????."
    }</div>`;
  }
  return `<div class="card-list">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.meta || {};
      return `<article class="candidate-card ${sel}" data-id="${esc(r.id)}">
        <div class="card-name-row">
          <span class="card-name">${esc(r.title || "(??? ???)")}</span>
          ${meta.status ? `<span class="badge">${esc(meta.status)}</span>` : ""}
        </div>
        <div class="card-meta-row">
          <span class="meta-pill platform" title="${esc(platformLabel(r.platform))}">${platformIcon(r.platform)}</span>
          <span class="meta-pill">${esc(meta.postingNumber || r.external_posting_id || "??)}</span>
          <span class="meta-pill stage">???${r.applicant_count ?? 0}??/span>
        </div>
        <div class="card-footer">
          <span class="muted">${esc(meta.manager || "???????)}${meta.period ? ` � ${esc(meta.period)}` : ""}</span>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderApplicantsCards() {
  if (!visibleRows().length) {
    return `<div class="empty">${
      filterApplicantPostingId
        ? "???????????? ????? ??????."
        : filterPostingStatus === "closed"
          ? "?? ?? ????? ??????."
          : "?? ???? ????? ??????. ??? ??? ????????????"
    }</div>`;
  }
  return `<div class="card-list">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.profile_meta || {};
      const postingMeta = r.posting?.meta || {};
      const name = r.candidate?.name || "(??? ???)";
      const posting = r.posting?.title || "????????;
      const postingNo = postingMeta.postingNumber ? ` � ${postingMeta.postingNumber}` : "";
      const badges = [
        isNew(r.created_at || r.applied_at) ? `<span class="badge new">NEW</span>` : "",
        !r.is_active || !r.candidate?.is_active ? `<span class="badge blocked">??</span>` : "",
        meta.platformStatus ? `<span class="badge">${esc(meta.platformStatus)}</span>` : "",
      ].join(" ");
      const subParts = [meta.genderAge, meta.careerTotal].filter(Boolean);
      const edu = [meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" � ");

      return `<article class="candidate-card ${sel}" data-id="${esc(r.id)}">
        <div class="card-top">
          <div class="card-top-main">
            ${meta.position ? `<p class="card-headline">${esc(meta.position)}</p>` : ""}
            <div class="card-name-row">
              <span class="card-name">${esc(name)}</span>
              ${badges}
            </div>
            ${subParts.length ? `<div class="card-sub">${esc(subParts.join(" � "))}</div>` : ""}
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
  if (!rows.length) return `<div class="empty">?????????? ??????.</div>`;
  return `<div class="card-list">${pageRows()
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.profile_meta || {};
      const name = r.candidate?.name || meta.name || "(??? ???)";
      const headline = r.headline || "";
      const badges = [
        isNew(r.sourced_at) ? `<span class="badge new">NEW</span>` : "",
        !r.is_active ? `<span class="badge blocked">??</span>` : "",
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
            ${subParts.length ? `<div class="card-sub">${esc(subParts.join(" � "))}</div>` : ""}
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
    pane.innerHTML = `<div class="empty detail-empty">????? ??????????????</div>`;
    return;
  }

  if ((tab === "applicants" || tab === "talent") && (staff?._unlinked || !staff?.id)) {
    pane.innerHTML = wrapDetail(
      "?? ??? ???",
      "?????? ???????,
      `<div class="panel"><p class="muted">?????? ??????staff_profiles ? ??????? ????????</p></div>`,
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
    ? Object.entries(meta.applicantCounts).find(([k]) => k.includes("???"))?.[1]
    : null;
  const body = `
    ${detailSection(
      "?? ???",
      infoRows([
        ["????", esc(meta.postingNumber || r.external_posting_id || "??)],
        ["???", esc(meta.status || (isPostingClosed(r) ? "??" : "?? ??))],
        ["?????, esc(meta.manager || "??)],
        ["??", esc(meta.period || "??)],
        [
          "????",
          `${selectedPostingApps.length || r.applicant_count || 0}?????${
            liveTotal != null ? ` � ????? ??? ${liveTotal}?? : ""
          }`,
        ],
        [
          "??? ??",
          r.source_url
            ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(platformLabel(r.platform))}??? ?? ${Icon.external({ size: 13, className: "inline-icon" })}</a>`
            : "??,
        ],
      ]),
      { icon: Icon.clipboard({ size: 16 }) },
    )}
    <div class="detail-actions">
      <button type="button" class="btn btn-primary btn-sm" id="btn-view-apps">???? ????????</button>
    </div>
    ${renderPostingApplicantsInDetail()}`;

  pane.innerHTML = wrapDetail(r.title || "(??? ???)", "", body, {
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

  const name = r.candidate?.name || "(??? ???)";
  const edu = [meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" � ");
  const headerBadges = [
    platformIcon(r.platform, { large: true }),
    `<span class="stage-pill">${esc(stageLabel(r.current_stage))}</span>`,
    isNew(r.applied_at) ? `<span class="badge new">NEW</span>` : "",
    !r.is_active || !r.candidate?.is_active ? `<span class="badge blocked">??</span>` : "",
    meta.platformStatus ? `<span class="badge">${esc(meta.platformStatus)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const subBits = [meta.position, meta.genderAge, meta.careerTotal ? `?? ${meta.careerTotal}` : ""]
    .filter(Boolean)
    .map(esc)
    .join(" � ");

  const highlightHtml = detailFacts([
    ["??????", esc(meta.desiredSalary || "??)],
    ["??", esc(meta.careerTotal || "??)],
    ["???", esc(edu || "??)],
    ["????", esc(fmtDate(r.applied_at))],
    ["?????, esc(fmtDate(r.created_at))],
    [
      "??????? ?????,
      meta.resumeLastModified
        ? esc(fmtResumeLastModified(meta.resumeLastModified))
        : "??,
    ],
  ]);

  const profileHtml = [
    highlightHtml,
    meta.recommendTags?.length ? renderChips(meta.recommendTags, "badge-chip") : "",
    meta.careerHistory?.length ? renderChips(meta.careerHistory) : "",
    detailSection(
      "?????,
      infoRows([["?????, esc(r.candidate?.email || "??)]]),
      { icon: Icon.phone({ size: 16 }) },
    ),
    detailSection(
      "???",
      renderDocuments(docs),
      { icon: Icon.file({ size: 16 }) },
    ),
    detailSection(
      "?????,
      renderProfileLinkRow(applicantListUrl(r), docs, { label: "????? ???? ??", listMode: true }),
      { icon: Icon.link({ size: 16 }) },
    ),
    detailSection(
      "??",
      infoRows([
        ["????, esc(r.posting?.title || "????????)],
        ["????", esc(postingMeta.postingNumber || r.posting?.external_posting_id || "??)],
        ["?????, esc(postingMeta.manager || "??)],
        [
          "?? ??",
          r.posting?.source_url
            ? `<a href="${esc(r.posting.source_url)}" target="_blank" rel="noopener">????? ?? ${Icon.external({ size: 13, className: "inline-icon" })}</a>`
            : "??,
        ],
      ]),
      { icon: Icon.clipboard({ size: 16 }) },
    ),
  ].join("");

  const docsHtml = `${
    caps().canRecommend
      ? `<div class="detail-actions">
          <button type="button" class="btn btn-primary" id="btn-recommend">?????</button>
          <span class="muted detail-hint">?? <b>${esc(staff?.nickname || "")}</b>??? ???</span>
        </div>`
      : `<p class="muted empty-inline">?????�??????? ??? <b>???</b> ?????? ??????????.</p>`
  }`;

  const tagsHtml = `
    ${renderTagChips(tags, { canRemove: true })}
    ${
      caps().canTagExtra
        ? `<div class="stack tag-form">
        <label>??? ???</label>
        <select id="tag-type">
          ${Object.entries(TAG_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <input id="tag-comment" placeholder="????(???)" />
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-tag">??? ????/button>
      </div>`
        : ""
    }`;

  const pipelineHtml = caps().canManagePipeline
    ? `${detailSection(
        "??",
        `<ul class="timeline">
        ${
          interviews.length
            ? interviews
                .map(
                  (i) => `<li><b>${esc(label(INTERVIEW_RESULT_LABELS, i.result, i.result))}</b>
                    � ${esc(new Date(i.interview_at).toLocaleString("ko-KR"))}
                    � ${esc(label(MEETING_LABELS, i.meeting_type, i.meeting_type))}
                    ${i.interviewer ? `� ${esc(i.interviewer)}` : ""}
                    ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ""}</li>`,
                )
                .join("")
            : `<li class="muted">??? ???</li>`
        }
      </ul>
      <div class="stack form-block">
        <label>?? ??? ???</label>
        <input id="iv-at" type="datetime-local" />
        <input id="iv-who" placeholder="???" />
        <select id="iv-type">
          ${Object.entries(MEETING_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <textarea id="iv-note" placeholder="??"></textarea>
        <button type="button" class="btn btn-primary btn-sm" id="btn-schedule">??? ????/button>
      </div>
      ${
        interviews[0]
          ? `<div class="stack form-block">
              <label>?? ?? ??</label>
              <select id="iv-result">
                ${Object.entries(INTERVIEW_RESULT_LABELS)
                  .filter(([k]) => k !== "scheduled")
                  .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
                  .join("")}
              </select>
              <input id="iv-hired" type="date" />
              <button type="button" class="btn btn-ghost btn-sm" id="btn-iv-result"
                data-ivid="${esc(interviews[0].id)}">?? ??</button>
            </div>`
          : ""
      }`,
        { icon: Icon.calendar({ size: 16 }) },
      )}
      ${detailSection(
        "??? ???,
        `<div class="stack form-block">
        <select id="stage">${stageOptions(r.current_stage)}</select>
        <input id="stage-reason" placeholder="???" />
        <div class="detail-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btn-stage">??? ????/button>
          ${caps().canBlock ? `<button type="button" class="btn btn-danger btn-sm" id="btn-block">??</button>` : ""}
        </div>
      </div>
      <ul class="timeline">
        ${
          history.length
            ? history
                .map(
                  (h) => `<li><b>${esc(stageLabel(h.status_code) !== "?? ? stageLabel(h.status_code) : h.status_code)}</b>
                    � ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}
                    � ${esc(staffNick(h.staff))}
                    ${h.reason ? `<div class="muted">${esc(h.reason)}</div>` : ""}</li>`,
                )
                .join("")
            : `<li class="muted">??? ???</li>`
        }
      </ul>`,
        { icon: Icon.chart({ size: 16 }) },
      )}`
    : detailSection(
        "??? ???",
        `<p class="stage-readonly">??? ???: <strong>${esc(stageLabel(r.current_stage))}</strong></p>
      <ul class="timeline">
        ${
          history.length
            ? history
                .map(
                  (h) => `<li><b>${esc(stageLabel(h.status_code) !== "?? ? stageLabel(h.status_code) : h.status_code)}</b>
                    � ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}
                    � ${esc(staffNick(h.staff))}</li>`,
                )
                .join("")
            : `<li class="muted">??? ???</li>`
        }
      </ul>`,
        { icon: Icon.chart({ size: 16 }) },
      );

  const body = [
    profileHtml,
    detailSection("??", docsHtml, { icon: Icon.star({ size: 16 }) }),
    detailSection("?? ???", tagsHtml, { icon: Icon.star({ size: 16 }) }),
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
      toast(`${staff.nickname || "??} ?? ???`);
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
      toast("??? ?????");
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.querySelectorAll("[data-rm-tag]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.removeTag(sb, btn.getAttribute("data-rm-tag"));
        toast("??? ?????);
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  if (!caps().canManagePipeline) return;

  document.getElementById("btn-schedule")?.addEventListener("click", async () => {
    const local = document.getElementById("iv-at").value;
    if (!local) return toast("?? ?????????????, true);
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
      toast("?? ??? ???");
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
      toast("?? ?? ??");
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
      toast("??? ????);
      await refresh(false);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-block")?.addEventListener("click", async () => {
    if (!confirm("????????? ???????")) return;
    try {
      await api.blockCandidate(sb, {
        candidateId,
        applicationId: r.id,
        reason: document.getElementById("stage-reason").value || "blocked via web",
        staffId: staff.id,
      });
      toast("?? ????);
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
  const name = r.candidate?.name || "(??? ???)";

  const [tags, history, docs] = await Promise.all([
    api.listTags(sb, "talent_pool", r.id),
    candidateId ? api.listStatusHistory(sb, candidateId) : Promise.resolve([]),
    api.listDocuments(sb, { candidateId, talentPoolId: r.id }),
  ]);

  const headerBadges = [
    platformIcon(r.platform, { large: true }),
    `<span class="stage-pill">${esc(proposalLabel(r.proposal_status))}</span>`,
    isNew(r.sourced_at) ? `<span class="badge new">NEW</span>` : "",
    !r.is_active ? `<span class="badge blocked">??</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const subBits = [r.headline, meta.genderAge, meta.careerText].filter(Boolean).map(esc).join(" � ");

  const profileHtml = [
    detailFacts([
      ["??? ???", esc(meta.company || "??)],
      ["??", esc(meta.careerText || "??)],
      ["?????, esc(fmtDate(r.sourced_at))],
    ]),
    renderChips(meta.roles),
    renderChips(meta.skills),
    renderChips(meta.badges, "badge-chip"),
    detailSection(
      "???",
      renderDocuments(docs),
      { icon: Icon.file({ size: 16 }) },
    ),
    detailSection(
      "?????,
      renderProfileLinkRow(r.profile_url, docs),
      { icon: Icon.link({ size: 16 }) },
    ),
  ].join("");

  const docsHtml = `${
    caps().canRecommend
      ? `<div class="detail-actions">
          <button type="button" class="btn btn-primary" id="btn-recommend">?????</button>
          <span class="muted detail-hint">?? <b>${esc(staff?.nickname || "")}</b></span>
        </div>`
      : `<p class="muted empty-inline">?????�??????? ??? <b>???</b> ?????? ??????????.</p>`
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
        <input id="tag-comment" placeholder="???? />
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-tag">??? ????/button>
      </div>`
        : ""
    }`;

  const blockHtml = caps().canBlock
    ? detailSection(
        "??",
        `<input id="block-reason" class="block-reason" placeholder="???" />
      <div class="detail-actions">
        <button type="button" class="btn btn-danger btn-sm" id="btn-block-talent">??? ??</button>
      </div>
      <ul class="timeline">
        ${
          history.length
            ? history
                .map(
                  (h) =>
                    `<li><b>${esc(h.status_code)}</b> � ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}</li>`,
                )
                .join("")
            : `<li class="muted">??? ???</li>`
        }
      </ul>`,
        { icon: Icon.ban({ size: 16 }) },
      )
    : "";

  const body = [
    profileHtml,
    detailSection("??", docsHtml, { icon: Icon.star({ size: 16 }) }),
    detailSection("?? ???", tagsHtml, { icon: Icon.star({ size: 16 }) }),
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
      toast(`${staff.nickname || "??} ?? ???`);
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
      toast("??? ?????");
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.querySelectorAll("[data-rm-tag]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.removeTag(sb, btn.getAttribute("data-rm-tag"));
        toast("??? ?????);
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
  document.getElementById("btn-block-talent")?.addEventListener("click", async () => {
    if (!confirm("????????????????????")) return;
    try {
      await api.blockTalent(sb, {
        talentId: r.id,
        candidateId,
        reason: document.getElementById("block-reason").value,
        staffId: staff.id,
      });
      toast("?? ????);
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
    // ????????JK/??????? ????????????????? ??
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
    `<div class="empty detail-empty">????? ??????????????</div>`,
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
