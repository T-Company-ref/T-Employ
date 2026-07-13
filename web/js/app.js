import { configReady, createClient } from "./client.js";
import * as api from "./api.js";
import {
  stageLabel,
  proposalLabel,
  platformLabel,
  label,
  STAGE_LABELS,
  PROPOSAL_STATUS_LABELS,
  TAG_LABELS,
  MEETING_LABELS,
  INTERVIEW_RESULT_LABELS,
} from "./labels.js";

const appEl = document.getElementById("app");

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let sb = null;
let staff = null;
let tab = "applicants";
let rows = [];
let selected = null;
let filterQ = "";
let filterPlatform = "";
let toastTimer = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function renderDocuments(docs) {
  if (!docs?.length) {
    return `<p class="muted">저장된 이력서가 없습니다. 크롤 시 PDF 수집 후 표시됩니다.</p>`;
  }
  return `<ul class="doc-list">${docs
    .map((d) => {
      const canDownload = d.file_url && !d.file_url.startsWith("file://");
      return `<li class="doc-item">
        <span>이력서 · ${esc(new Date(d.collected_at).toLocaleDateString("ko-KR"))}</span>
        ${
          canDownload
            ? `<a class="btn btn-primary btn-sm" href="${esc(d.file_url)}" target="_blank" rel="noopener" download>PDF 다운로드</a>`
            : `<span class="muted">로컬 저장 (웹 다운로드 불가)</span>`
        }
      </li>`;
    })
    .join("")}</ul>`;
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
        <p class="sub">기업 이메일로 로그인해 지원자·인재검색을 관리합니다.</p>
        <div class="field">
          <label for="email">이메일</label>
          <input id="email" name="email" type="email" autocomplete="username" required placeholder="name@tbell.co.kr" />
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
    const email = String(fd.get("email") || "").trim();
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

function shell(innerList, innerDetail) {
  const who = staff?.display_name || staff?.email || "—";
  const role = staff?.role || "";
  appEl.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">TBELL <span>Employ</span></div>
        <nav class="nav">
          <button type="button" data-tab="applicants" class="${tab === "applicants" ? "active" : ""}">지원자</button>
          <button type="button" data-tab="talent" class="${tab === "talent" ? "active" : ""}">인재검색</button>
        </nav>
        <div class="userbox">
          <span>${esc(who)}${role ? ` · ${esc(role)}` : ""}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-logout">로그아웃</button>
        </div>
      </header>
      <div class="main">
        <section class="list-pane" id="list-pane">${innerList}</section>
        <aside class="detail-pane" id="detail-pane">${innerDetail}</aside>
      </div>
    </div>`;

  appEl.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      tab = btn.getAttribute("data-tab");
      selected = null;
      await refresh();
    });
  });
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await api.signOut(sb);
    staff = null;
    renderLogin();
  });
}

function renderApplicantsCards() {
  if (!rows.length) {
    return `<div class="empty">지원자가 없습니다. 크롤 수집 후 새로고침하세요.</div>`;
  }
  return `<div class="card-list">${rows
    .map((r) => {
      const sel = selected?.id === r.id ? "selected" : "";
      const meta = r.profile_meta || {};
      const postingMeta = r.posting?.meta || {};
      const name = r.candidate?.name || "(이름 없음)";
      const posting = r.posting?.title || "공고명 미수집";
      const postingNo = postingMeta.postingNumber ? ` · ${postingMeta.postingNumber}` : "";
      const badges = [
        isNew(r.applied_at) ? `<span class="badge new">NEW</span>` : "",
        !r.is_active || !r.candidate?.is_active ? `<span class="badge blocked">블락</span>` : "",
        meta.platformStatus ? `<span class="badge">${esc(meta.platformStatus)}</span>` : "",
      ].join(" ");

      const subParts = [meta.genderAge, meta.careerTotal].filter(Boolean);

      return `<article class="candidate-card ${sel}" data-id="${esc(r.id)}">
        ${meta.position ? `<p class="card-headline">${esc(meta.position)}</p>` : ""}
        <div class="card-name-row">
          <span class="card-name">${esc(name)}</span>
          ${badges}
        </div>
        ${subParts.length ? `<div class="card-sub">${esc(subParts.join(" · "))}</div>` : ""}
        <div class="card-meta-row">
          <span class="meta-pill platform">${esc(platformLabel(r.platform))}</span>
          <span class="meta-pill stage">${esc(stageLabel(r.current_stage))}</span>
          ${meta.desiredSalary ? `<span class="meta-pill">${esc(meta.desiredSalary)}</span>` : ""}
        </div>
        ${renderChips(meta.recommendTags, "badge-chip")}
        ${meta.educationSchool ? `<div class="card-sub">${esc([meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" · "))}</div>` : ""}
        ${renderChips(meta.careerHistory?.slice(0, 3))}
        <div class="card-footer">
          <span class="card-posting">${esc(posting)}${esc(postingNo)}</span>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderTalentCards() {
  if (!rows.length) {
    return `<div class="empty">인재검색 후보가 없습니다.</div>`;
  }
  return `<div class="card-list">${rows
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
        ${headline ? `<p class="card-headline">${esc(headline)}</p>` : ""}
        <div class="card-name-row">
          <span class="card-name">${esc(name)}</span>
          ${badges}
        </div>
        ${subParts.length ? `<div class="card-sub">${esc(subParts.join(" · "))}</div>` : ""}
        <div class="card-meta-row">
          <span class="meta-pill platform">${esc(platformLabel(r.platform))}</span>
          <span class="meta-pill stage">${esc(proposalLabel(r.proposal_status))}</span>
          ${meta.company ? `<span class="meta-pill">${esc(meta.company)}</span>` : ""}
        </div>
        ${renderChips(meta.roles?.slice(0, 6))}
        ${renderChips(meta.skills?.slice(0, 8))}
        ${renderChips(meta.badges, "badge-chip")}
      </article>`;
    })
    .join("")}</div>`;
}

function listToolbar(title) {
  return `
    <div class="toolbar">
      <h2>${esc(title)}</h2>
      <input class="search" id="q" placeholder="검색 (이름·공고·키워드…)" value="${esc(filterQ)}" />
      <select class="select" id="platform">
        <option value="">전체 플랫폼</option>
        <option value="jobkorea" ${filterPlatform === "jobkorea" ? "selected" : ""}>잡코리아</option>
        <option value="saramin" ${filterPlatform === "saramin" ? "selected" : ""}>사람인</option>
      </select>
      <button type="button" class="btn btn-ghost btn-sm" id="btn-refresh">새로고침</button>
    </div>`;
}

function stageOptions(current) {
  return Object.entries(STAGE_LABELS)
    .map(([v, l]) => `<option value="${v}" ${current === v ? "selected" : ""}>${esc(l)}</option>`)
    .join("");
}

async function renderDetail() {
  const pane = document.getElementById("detail-pane");
  if (!pane) return;
  if (!selected) {
    pane.innerHTML = `<div class="empty">왼쪽 목록에서 항목을 선택하세요.</div>`;
    return;
  }

  if (staff?._unlinked || !staff?.id) {
    pane.innerHTML = `<div class="panel"><h3>권한 연결 필요</h3>
      <p class="muted">로그인은 됐지만 staff_profiles 가 연결되지 않았습니다.</p></div>`;
    return;
  }

  if (tab === "applicants") await renderApplicantDetail(pane);
  else await renderTalentDetail(pane);
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

  pane.innerHTML = `
    <div class="panel">
      <h3>${esc(r.candidate?.name || "(이름 없음)")}</h3>
      ${meta.position ? `<div class="profile-block"><div class="headline">${esc(meta.position)}</div></div>` : ""}
      <div class="profile-block">
        ${meta.genderAge ? `<div class="card-sub">${esc(meta.genderAge)}</div>` : ""}
        ${renderChips(meta.recommendTags, "badge-chip")}
        ${meta.careerTotal ? `<div class="card-sub">경력 ${esc(meta.careerTotal)}</div>` : ""}
        ${renderChips(meta.careerHistory)}
      </div>
      <dl class="meta-grid">
        <dt>이메일</dt><dd>${esc(r.candidate?.email || "—")}</dd>
        <dt>전화</dt><dd>${esc(r.candidate?.phone || "—")}</dd>
        <dt>플랫폼</dt><dd>${esc(platformLabel(r.platform))}</dd>
        <dt>공고</dt><dd>${esc(r.posting?.title || "공고명 미수집")}</dd>
        <dt>공고번호</dt><dd>${esc(postingMeta.postingNumber || r.posting?.external_posting_id || "—")}</dd>
        <dt>담당자</dt><dd>${esc(postingMeta.manager || "—")}</dd>
        <dt>공고기간</dt><dd>${esc(postingMeta.period || "—")}</dd>
        <dt>학력</dt><dd>${esc([meta.educationLevel, meta.educationSchool, meta.educationMajor].filter(Boolean).join(" · ") || "—")}</dd>
        <dt>희망연봉</dt><dd>${esc(meta.desiredSalary || "—")}</dd>
        <dt>진행상태</dt><dd>${esc(meta.platformStatus || stageLabel(r.current_stage))}</dd>
        <dt>단계</dt><dd>${esc(stageLabel(r.current_stage))}</dd>
        ${r.posting?.source_url ? `<dt>공고 보기</dt><dd><a href="${esc(r.posting.source_url)}" target="_blank" rel="noopener">잡코리아 공고</a></dd>` : ""}
      </dl>
    </div>

    <div class="panel">
      <h3>이력서</h3>
      ${renderDocuments(docs)}
    </div>

    <div class="panel">
      <h3>추천 태그</h3>
      <div class="chip-row" id="tag-list">
        ${
          tags.length
            ? tags
                .map(
                  (t) => `<span class="chip">${esc(label(TAG_LABELS, t.tag_type, t.tag_type))}
                    ${t.comment ? `· ${esc(t.comment)}` : ""}
                    <span class="muted">(${esc(t.staff?.nickname || "")})</span>
                    <button type="button" data-rm-tag="${esc(t.id)}" title="제거">×</button>
                  </span>`,
                )
                .join("")
            : `<span class="muted">태그 없음</span>`
        }
      </div>
      <div class="stack" style="margin-top:12px">
        <label>태그 추가</label>
        <select id="tag-type">
          ${Object.entries(TAG_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <input id="tag-comment" placeholder="코멘트 (선택)" />
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-tag" style="width:auto">태그 저장</button>
      </div>
    </div>

    <div class="panel">
      <h3>면접</h3>
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
            : `<li class="muted">일정 없음</li>`
        }
      </ul>
      <div class="stack" style="margin-top:12px">
        <label>면접 일정 등록</label>
        <input id="iv-at" type="datetime-local" />
        <input id="iv-who" placeholder="면접관" />
        <select id="iv-type">
          ${Object.entries(MEETING_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <textarea id="iv-note" placeholder="메모"></textarea>
        <button type="button" class="btn btn-primary btn-sm" id="btn-schedule" style="width:auto">일정 저장</button>
      </div>
      ${
        interviews[0]
          ? `<div class="stack" style="margin-top:14px">
              <label>최근 면접 결과</label>
              <select id="iv-result">
                ${Object.entries(INTERVIEW_RESULT_LABELS)
                  .filter(([k]) => k !== "scheduled")
                  .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
                  .join("")}
              </select>
              <input id="iv-hired" type="date" placeholder="입사일(선택)" />
              <button type="button" class="btn btn-ghost btn-sm" id="btn-iv-result" style="width:auto"
                data-ivid="${esc(interviews[0].id)}">결과 반영</button>
            </div>`
          : ""
      }
    </div>

    <div class="panel">
      <h3>상태 변경</h3>
      <div class="stack">
        <select id="stage">${stageOptions(r.current_stage)}</select>
        <input id="stage-reason" placeholder="사유" />
        <div class="actions">
          <button type="button" class="btn btn-primary btn-sm" id="btn-stage">단계 저장</button>
          <button type="button" class="btn btn-danger btn-sm" id="btn-block">블락</button>
        </div>
      </div>
      <ul class="timeline" style="margin-top:12px">
        ${
          history.length
            ? history
                .map(
                  (h) => `<li><b>${esc(stageLabel(h.status_code) !== "—" ? stageLabel(h.status_code) : h.status_code)}</b>
                    · ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}
                    · ${esc(h.staff?.nickname || "")}
                    ${h.reason ? `<div class="muted">${esc(h.reason)}</div>` : ""}</li>`,
                )
                .join("")
            : `<li class="muted">이력 없음</li>`
        }
      </ul>
    </div>`;

  bindApplicantActions(r, candidateId);
}

function bindApplicantActions(r, candidateId) {
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

  pane.innerHTML = `
    <div class="panel">
      <div class="profile-block">
        ${r.headline ? `<div class="headline">${esc(r.headline)}</div>` : ""}
        <div class="card-name-row">
          <span class="card-name">${esc(name)}</span>
          ${meta.genderAge ? `<span class="card-sub">${esc(meta.genderAge)}</span>` : ""}
          ${meta.careerText ? `<span class="card-sub">${esc(meta.careerText)}</span>` : ""}
        </div>
        ${meta.company ? `<div class="card-sub" style="margin-top:6px">${esc(meta.company)}</div>` : ""}
        ${renderChips(meta.roles)}
        ${renderChips(meta.skills)}
        ${renderChips(meta.badges, "badge-chip")}
      </div>
      <dl class="meta-grid">
        <dt>플랫폼</dt><dd>${esc(platformLabel(r.platform))}</dd>
        <dt>상태</dt><dd>${esc(proposalLabel(r.proposal_status))}</dd>
        <dt>원본</dt><dd>${r.profile_url ? `<a href="${esc(r.profile_url)}" target="_blank" rel="noopener">잡코리아에서 보기</a>` : "—"}</dd>
      </dl>
    </div>

    <div class="panel">
      <h3>이력서</h3>
      ${renderDocuments(docs)}
    </div>

    <div class="panel">
      <h3>추천 태그</h3>
      <div class="chip-row">
        ${
          tags.length
            ? tags
                .map(
                  (t) => `<span class="chip">${esc(label(TAG_LABELS, t.tag_type, t.tag_type))}
                    ${t.comment ? `· ${esc(t.comment)}` : ""}
                    <button type="button" data-rm-tag="${esc(t.id)}">×</button></span>`,
                )
                .join("")
            : `<span class="muted">태그 없음</span>`
        }
      </div>
      <div class="stack" style="margin-top:12px">
        <select id="tag-type">
          ${Object.entries(TAG_LABELS)
            .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
            .join("")}
        </select>
        <input id="tag-comment" placeholder="코멘트" />
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-tag" style="width:auto">태그 저장</button>
      </div>
    </div>
    <div class="panel">
      <h3>블락</h3>
      <input id="block-reason" placeholder="사유" style="width:100%;margin-bottom:10px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px" />
      <button type="button" class="btn btn-danger btn-sm" id="btn-block-talent">인재 블락</button>
      <ul class="timeline" style="margin-top:12px">
        ${
          history.length
            ? history.map((h) => `<li><b>${esc(h.status_code)}</b> · ${esc(new Date(h.changed_at).toLocaleString("ko-KR"))}</li>`).join("")
            : `<li class="muted">이력 없음</li>`
        }
      </ul>
    </div>`;

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

async function refresh(resetSelection = true) {
  if (resetSelection) selected = null;
  const keepId = selected?.id;

  if (tab === "applicants") {
    rows = await api.listApplications(sb, { q: filterQ, platform: filterPlatform });
  } else {
    rows = await api.listTalents(sb, { q: filterQ, platform: filterPlatform });
  }

  if (keepId) selected = rows.find((r) => r.id === keepId) || null;

  const title = tab === "applicants" ? "공고 지원자" : "인재검색";
  const cards = tab === "applicants" ? renderApplicantsCards() : renderTalentCards();
  shell(`${listToolbar(title)}${cards}`, `<div class="empty">선택 대기…</div>`);

  document.getElementById("btn-refresh")?.addEventListener("click", () => refresh(false));
  document.getElementById("q")?.addEventListener("change", async (e) => {
    filterQ = e.target.value;
    await refresh(false);
  });
  document.getElementById("q")?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      filterQ = e.target.value;
      await refresh(false);
    }
  });
  document.getElementById("platform")?.addEventListener("change", async (e) => {
    filterPlatform = e.target.value;
    await refresh(false);
  });

  document.querySelectorAll(".candidate-card[data-id]").forEach((card) => {
    card.addEventListener("click", async () => {
      selected = rows.find((r) => r.id === card.getAttribute("data-id")) || null;
      document.querySelectorAll(".candidate-card").forEach((x) => x.classList.remove("selected"));
      card.classList.add("selected");
      try {
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  if (selected) {
    try {
      await renderDetail();
    } catch (e) {
      toast(e.message, true);
    }
  } else {
    document.getElementById("detail-pane").innerHTML =
      `<div class="empty">왼쪽 목록에서 항목을 선택하세요.</div>`;
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
