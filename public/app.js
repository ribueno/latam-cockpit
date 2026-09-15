const PILLARS = [
  "Build Foundation",
  "Proactive Attrition Prevention",
  "Reactive Attrition Recovery",
  "Proactive Consumption Booster",
  "Pre-Sales",
];
const STATUSES = ["Not Started", "In Progress", "Blocked", "Completed"];
const OPEN_STATUSES = ["Not Started", "In Progress", "Blocked"];
const MEETING_WEEKDAY = 3; // Wednesday
const SORT_OPTIONS = [
  "Urgency (Most Urgent)", "ID (Ascending)", "ID (Descending)",
  "Due Date (Soonest)", "Due Date (Latest)",
  "Progress (High to Low)", "Progress (Low to High)", "Owner (A-Z)", "Owner (Z-A)",
];
const URGENCY_OPTIONS = ["All", "Overdue", "Blocked", "Due before meeting", "Open"];

const state = {
  actions: [],
  filters: { pillar: "All", owner: "All", status: "All", search: "", sort: "Urgency (Most Urgent)", activityTag: "All", urgency: "All" },
};

const $ = (sel) => document.querySelector(sel);
const els = {
  tableBody: $("#actionsTableBody"), pillarCards: $("#pillarCards"), rowCount: $("#rowCount"),
  overdueList: $("#overdueList"), blockedList: $("#blockedList"), helpList: $("#helpList"),
  pillarFilter: $("#pillarFilter"), ownerFilter: $("#ownerFilter"), statusFilter: $("#statusFilter"),
  searchFilter: $("#searchFilter"), sortFilter: $("#sortFilter"), activityTagFilter: $("#activityTagFilter"),
  urgencyFilter: $("#urgencyFilter"),
  actionDialog: $("#actionDialog"), addActionBtn: $("#addActionBtn"), downloadBackupBtn: $("#downloadBackupBtn"),
  logoutBtn: $("#logoutBtn"), backupStatus: $("#backupStatus"), cancelDialogBtn: $("#cancelDialogBtn"),
  newActionForm: $("#newActionForm"), kpiStrip: $("#kpiStrip"), ownerTodoBoard: $("#ownerTodoBoard"),
  meetingCountdown: $("#meetingCountdown"), slackStatus: $("#slackStatus"), slackOwnerMapping: $("#slackOwnerMapping"),
  slackSchedule: $("#slackSchedule"), previewRemindersBtn: $("#previewRemindersBtn"), sendRemindersBtn: $("#sendRemindersBtn"),
  sendResult: $("#sendResult"), previewDialog: $("#previewDialog"), previewBody: $("#previewBody"), closePreviewBtn: $("#closePreviewBtn"),
};

bootstrap();
async function bootstrap() {
  state.actions = await loadData();
  await refreshBackupStatus();
  buildDialogPillarOptions();
  configureFilters();
  bindEvents();
  render();
  loadSlackConfig();
}

/* ---------- date / urgency helpers (mirror lib/plan.js) ---------- */
function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function nextMeetingDate() { const d = startOfToday(); d.setDate(d.getDate() + ((MEETING_WEEKDAY - d.getDay() + 7) % 7)); return d; }
function isOpen(a) { return OPEN_STATUSES.includes(a.status); }
function isOverdue(a) { return isOpen(a) && a.dueDate && new Date(a.dueDate) < startOfToday(); }
function isDueBeforeMeeting(a) { return isOpen(a) && a.dueDate && new Date(a.dueDate) <= nextMeetingDate(); }
function urgency(a) {
  if (!isOpen(a)) return "done";
  if (isOverdue(a)) return "overdue";
  if (a.status === "Blocked") return "blocked";
  if (isDueBeforeMeeting(a)) return "due-soon";
  return "later";
}
const URGENCY_RANK = { overdue: 0, blocked: 1, "due-soon": 2, later: 3, done: 4 };
function fmtDate(v) { if (!v) return "no due date"; const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }

/* ---------- filters ---------- */
function configureFilters() {
  fillSelect(els.pillarFilter, ["All", ...PILLARS]);
  fillSelect(els.statusFilter, ["All", ...STATUSES]);
  fillSelect(els.urgencyFilter, URGENCY_OPTIONS);
  fillSelect(els.sortFilter, SORT_OPTIONS);
  els.sortFilter.value = state.filters.sort;
  updateOwnerFilterOptions();
  updateActivityTagFilterOptions();
}
function fillSelect(select, values) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v}</option>`).join("");
}
function updateOwnerFilterOptions() {
  const owners = [...new Set(state.actions.map((i) => i.owner))].sort();
  fillSelect(els.ownerFilter, ["All", ...owners]);
  if (![...els.ownerFilter.options].some((o) => o.value === state.filters.owner)) { state.filters.owner = "All"; }
  els.ownerFilter.value = state.filters.owner;
}
function updateActivityTagFilterOptions() {
  const tags = [...new Set(state.actions.map((i) => String(i.action||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  fillSelect(els.activityTagFilter, ["All", ...tags]);
  if (![...els.activityTagFilter.options].some((o) => o.value === state.filters.activityTag)) { state.filters.activityTag = "All"; }
  els.activityTagFilter.value = state.filters.activityTag;
}

function bindEvents() {
  els.pillarFilter.addEventListener("change", (e) => { state.filters.pillar = e.target.value; render(); });
  els.ownerFilter.addEventListener("change", (e) => { state.filters.owner = e.target.value; render(); });
  els.statusFilter.addEventListener("change", (e) => { state.filters.status = e.target.value; render(); });
  els.urgencyFilter.addEventListener("change", (e) => { state.filters.urgency = e.target.value; render(); });
  els.searchFilter.addEventListener("input", (e) => { state.filters.search = e.target.value.trim().toLowerCase(); render(); });
  els.sortFilter.addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });
  els.activityTagFilter.addEventListener("change", (e) => { state.filters.activityTag = e.target.value; render(); });

  els.addActionBtn.addEventListener("click", () => els.actionDialog.showModal());
  els.downloadBackupBtn.addEventListener("click", () => { window.location.href = "/api/backups/latest"; });
  els.logoutBtn.addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); window.location.href = "/login"; });
  els.cancelDialogBtn.addEventListener("click", () => els.actionDialog.close());
  els.closePreviewBtn.addEventListener("click", () => els.previewDialog.close());
  els.previewRemindersBtn.addEventListener("click", previewReminders);
  els.sendRemindersBtn.addEventListener("click", sendReminders);

  els.newActionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(els.newActionForm);
    await createAction({
      pillar: data.get("pillar"), action: data.get("action"), description: data.get("description"),
      progressText: data.get("progressText"), owner: data.get("owner"), dueDate: data.get("dueDate"),
      status: data.get("status"), progress: clampProgress(Number(data.get("progress"))), helpNeeded: data.get("helpNeeded"),
    });
    await reloadDataAndRender();
    els.newActionForm.reset();
    els.actionDialog.close();
  });
}

/* ---------- render ---------- */
function render() {
  renderKpis();
  renderMeetingCountdown();
  renderOwnerBoard();
  renderPillarCards();
  renderTable(getFilteredActions());
  renderWeeklyFocus();
}

function renderKpis() {
  const a = state.actions;
  const total = a.length;
  const completed = a.filter((i) => i.status === "Completed").length;
  const inProgress = a.filter((i) => i.status === "In Progress").length;
  const blocked = a.filter((i) => i.status === "Blocked").length;
  const overdue = a.filter(isOverdue).length;
  const help = a.filter((i) => (i.helpNeeded || "").trim()).length;
  const dueSoon = a.filter((i) => urgency(i) === "due-soon").length;
  const avg = total ? Math.round(a.reduce((s, i) => s + Number(i.progress || 0), 0) / total) : 0;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const tiles = [
    { label: "Activities", value: total },
    { label: "Completed", value: `${pct}%`, cls: "ok" },
    { label: "Avg Progress", value: `${avg}%` },
    { label: "Due before mtg", value: dueSoon, cls: dueSoon ? "warn" : "" },
    { label: "Overdue", value: overdue, cls: overdue ? "bad" : "ok" },
    { label: "Blocked", value: blocked, cls: blocked ? "warn" : "" },
    { label: "Help Needed", value: help, cls: help ? "warn" : "" },
  ];
  els.kpiStrip.innerHTML = tiles.map((t) =>
    `<div class="kpi ${t.cls||""}"><div class="kpi-value">${t.value}</div><div class="kpi-label">${t.label}</div></div>`).join("");
}

function renderMeetingCountdown() {
  const meeting = nextMeetingDate();
  const days = Math.round((meeting - startOfToday()) / 86400000);
  const label = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  els.meetingCountdown.textContent = `Next Wednesday meeting: ${fmtDate(meeting)} (${label})`;
}

function ownerDigests() {
  const map = new Map();
  for (const a of state.actions) {
    if (!isOpen(a)) continue;
    if (!isDueBeforeMeeting(a) && !isOverdue(a)) continue;
    const key = (a.owner || "").trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, { owner: (a.owner || "").trim(), items: [] });
    map.get(key).items.push(a);
  }
  for (const d of map.values()) {
    d.items.sort((x, y) => (URGENCY_RANK[urgency(x)] - URGENCY_RANK[urgency(y)]) || String(x.dueDate||"").localeCompare(String(y.dueDate||"")));
  }
  return [...map.values()].sort((a, b) => a.owner.localeCompare(b.owner));
}

function renderOwnerBoard() {
  const digests = ownerDigests();
  if (!digests.length) { els.ownerTodoBoard.innerHTML = `<p class="hint">No open items due before the next meeting. 🎉</p>`; return; }
  els.ownerTodoBoard.innerHTML = digests.map((d) => `
    <div class="owner-col">
      <h4>${escapeHtml(d.owner)}<span class="count">${d.items.length}</span></h4>
      ${d.items.map((it) => {
        const u = urgency(it);
        return `<div class="todo ${u}">
          <div class="u-tag ${u}">${u === "overdue" ? "Overdue" : u === "blocked" ? "Blocked" : "Due " + fmtDate(it.dueDate)}</div>
          <div class="t-title">${escapeHtml(it.action)}</div>
          <div class="t-meta">${escapeHtml(it.pillar)} · ${it.progress || 0}%${it.helpNeeded && it.helpNeeded.trim() ? " · ⚠ help needed" : ""}</div>
        </div>`;
      }).join("")}
    </div>`).join("");
}

function renderPillarCards() {
  els.pillarCards.innerHTML = PILLARS.map((pillar) => {
    const g = state.actions.filter((i) => i.pillar === pillar);
    const total = g.length;
    const avg = total ? Math.round(g.reduce((s, i) => s + Number(i.progress || 0), 0) / total) : 0;
    const completed = g.filter((i) => i.status === "Completed").length;
    const inProgress = g.filter((i) => i.status === "In Progress").length;
    const notStarted = g.filter((i) => i.status === "Not Started").length;
    const overdue = g.filter(isOverdue).length;
    return `<article class="card pillar-card">
      <h3>${pillar}</h3>
      <p><strong>${total}</strong> activities · <strong>${avg}%</strong> avg</p>
      <div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div>
      <div class="pillar-meta">
        <span class="pill pill-green">${completed} done</span>
        <span class="pill pill-amber">${inProgress} in progress</span>
        <span class="pill">${notStarted} not started</span>
        <span class="pill pill-red">${overdue} overdue</span>
      </div>
    </article>`;
  }).join("");
}

function renderTable(items) {
  els.rowCount.textContent = `${items.length} activit${items.length === 1 ? "y" : "ies"}`;
  els.tableBody.innerHTML = items.map((item) => {
    const u = urgency(item);
    const rowCls = u === "overdue" ? "row-overdue" : u === "blocked" ? "row-blocked" : "";
    return `<tr data-id="${item.id}" class="${rowCls}">
      <td class="id-cell">${escapeHtml(item.id)}${renderActivityTagBadge(item.action)}</td>
      <td>${renderSelect("pillar", item.pillar, PILLARS)}</td>
      <td>${renderTextarea("action", item.action)}</td>
      <td>${renderTextarea("description", item.description)}</td>
      <td>${renderTextarea("progressText", item.progressText)}</td>
      <td>${renderTextarea("helpNeeded", item.helpNeeded)}</td>
      <td>${renderTextarea("owner", item.owner)}</td>
      <td>${renderDateInput("dueDate", item.dueDate)}</td>
      <td>${renderSelect("status", item.status, STATUSES)}</td>
      <td>${renderNumberInput("progress", item.progress)}</td>
      <td><button class="btn remove-row">Delete</button></td>
    </tr>`;
  }).join("");
  els.tableBody.querySelectorAll("input, select, textarea").forEach((f) => f.addEventListener("change", handleInlineEdit));
  els.tableBody.querySelectorAll(".remove-row").forEach((b) => b.addEventListener("click", handleDelete));
}

function renderWeeklyFocus() {
  fillList(els.overdueList, state.actions.filter(isOverdue), (i) => `${i.id}: ${i.action} (${i.owner})`);
  fillList(els.blockedList, state.actions.filter((i) => i.status === "Blocked"), (i) => `${i.id}: ${i.action}`);
  fillList(els.helpList, state.actions.filter((i) => (i.helpNeeded||"").trim().length > 0), (i) => `${i.id}: ${i.helpNeeded}`);
}
function fillList(el, items, fmt) {
  el.innerHTML = items.length ? items.map((i) => `<li>${escapeHtml(fmt(i))}</li>`).join("") : "<li>No items</li>";
}

function getFilteredActions() {
  const f = state.filters;
  const filtered = state.actions.filter((item) => {
    if (f.pillar !== "All" && item.pillar !== f.pillar) return false;
    if (f.owner !== "All" && item.owner !== f.owner) return false;
    if (f.status !== "All" && item.status !== f.status) return false;
    if (f.activityTag !== "All" && normalize(item.action) !== normalize(f.activityTag)) return false;
    if (f.urgency !== "All") {
      const u = urgency(item);
      if (f.urgency === "Overdue" && u !== "overdue") return false;
      if (f.urgency === "Blocked" && u !== "blocked") return false;
      if (f.urgency === "Due before meeting" && !(u === "due-soon" || u === "overdue")) return false;
      if (f.urgency === "Open" && !isOpen(item)) return false;
    }
    if (f.search) {
      const t = `${item.action} ${item.description} ${item.progressText||""} ${item.helpNeeded} ${item.owner}`.toLowerCase();
      if (!t.includes(f.search)) return false;
    }
    return true;
  });
  return sortActions(filtered);
}

function sortActions(items) {
  const s = [...items], by = state.filters.sort;
  const cmpId = (a, b) => {
    const p = (v) => { const m = String(v||"").match(/^P(\d+)-(\d+)$/i); return m ? [Number(m[1]), Number(m[2])] : [9e9, 9e9]; };
    const [ag, as] = p(a.id), [bg, bs] = p(b.id); return ag - bg || as - bs;
  };
  switch (by) {
    case "Urgency (Most Urgent)": return s.sort((a,b)=> (URGENCY_RANK[urgency(a)]-URGENCY_RANK[urgency(b)]) || String(a.dueDate||"").localeCompare(String(b.dueDate||"")));
    case "ID (Ascending)": return s.sort(cmpId);
    case "ID (Descending)": return s.sort((a,b)=>cmpId(b,a));
    case "Due Date (Soonest)": return s.sort((a,b)=>cmpDate(a.dueDate,b.dueDate));
    case "Due Date (Latest)": return s.sort((a,b)=>cmpDate(b.dueDate,a.dueDate));
    case "Progress (High to Low)": return s.sort((a,b)=>Number(b.progress||0)-Number(a.progress||0));
    case "Progress (Low to High)": return s.sort((a,b)=>Number(a.progress||0)-Number(b.progress||0));
    case "Owner (A-Z)": return s.sort((a,b)=>String(a.owner||"").localeCompare(String(b.owner||"")));
    case "Owner (Z-A)": return s.sort((a,b)=>String(b.owner||"").localeCompare(String(a.owner||"")));
    default: return s;
  }
}
function cmpDate(a, b) { if (!a && !b) return 0; if (!a) return 1; if (!b) return -1; return new Date(a) - new Date(b); }

/* ---------- inline edit / CRUD ---------- */
async function handleInlineEdit(event) {
  const tr = event.target.closest("tr");
  const action = state.actions.find((i) => i.id === tr.dataset.id);
  const field = event.target.dataset.field;
  if (!action || !field) return;
  let value = event.target.value;
  if (field === "progress") value = clampProgress(Number(value));
  action[field] = value;
  await updateAction(action);
  await reloadDataAndRender();
}
async function handleDelete(event) {
  const tr = event.target.closest("tr");
  await removeAction(tr.dataset.id);
  await reloadDataAndRender();
}
async function reloadDataAndRender() {
  state.actions = await loadData();
  await refreshBackupStatus();
  updateOwnerFilterOptions();
  updateActivityTagFilterOptions();
  render();
}
async function createAction(action) {
  const r = await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  if (!r.ok) throw new Error("Failed to create activity");
}
async function updateAction(action) {
  const r = await fetch(`/api/actions/${encodeURIComponent(action.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  if (!r.ok) throw new Error("Failed to update activity");
}
async function removeAction(id) {
  const r = await fetch(`/api/actions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to remove activity");
}
async function loadData() {
  try {
    const r = await fetch("/api/actions");
    if (!r.ok) throw new Error();
    const p = await r.json();
    return Array.isArray(p.actions) ? p.actions : [];
  } catch { return []; }
}
async function refreshBackupStatus() {
  try {
    const r = await fetch("/api/backups/meta"); const p = await r.json();
    els.backupStatus.textContent = p.lastBackupAt ? `Backup status: latest at ${new Date(p.lastBackupAt).toLocaleString()}` : "Backup status: no backup yet (use Download Backup)";
  } catch { els.backupStatus.textContent = "Backup status: unavailable"; }
}

/* ---------- Slack ---------- */
async function loadSlackConfig() {
  try {
    const r = await fetch("/api/reminders/config"); const c = await r.json();
    els.slackStatus.textContent = c.slackConfigured
      ? "✅ Slack connected. Reminders go to owners' DMs."
      : "⚠ Slack token not set — Preview works, Send is disabled. Set SLACK_BOT_TOKEN.";
    els.sendRemindersBtn.disabled = !c.slackConfigured;
    els.slackSchedule.textContent = `Auto-send: ${c.cron} (${c.tz}) — ${c.enabled ? "ENABLED" : "preview-only"}. Next meeting ${c.nextMeeting}.`;
    els.slackOwnerMapping.innerHTML = c.owners.map((o) =>
      `<li><span>${escapeHtml(o.owner)}</span><span class="dot ${o.mapped ? "on" : "off"}" title="${o.mapped ? "mapped" : "not mapped in slack/owners.json"}"></span></li>`).join("");
  } catch {
    els.slackStatus.textContent = "Could not load Slack config.";
  }
}
async function previewReminders() {
  els.sendResult.textContent = "Building preview…";
  const r = await fetch("/api/reminders/preview"); const { report } = await r.json();
  renderPreview(report);
  els.sendResult.textContent = `${report.results.length} owner message(s) prepared.`;
  els.previewDialog.showModal();
}
async function sendReminders() {
  if (!confirm("Send Slack reminders now to all mapped owners with open items due before the meeting?")) return;
  els.sendResult.textContent = "Sending…";
  const r = await fetch("/api/reminders/send", { method: "POST" });
  const data = await r.json();
  if (!data.ok) { els.sendResult.textContent = `Error: ${data.error}`; return; }
  const t = data.report.totals;
  els.sendResult.textContent = "Sent: " + Object.entries(t).map(([k,v]) => `${v} ${k}`).join(", ");
}
function renderPreview(report) {
  els.previewBody.innerHTML = report.results.length
    ? report.results.map((r) => `<div class="preview-msg"><h5>${escapeHtml(r.owner)} — <em>${r.status}</em> (${r.itemCount} items)</h5>${escapeHtml(r.preview)}</div>`).join("")
    : "<p>No owners have open items due before the next meeting.</p>";
}

/* ---------- render helpers ---------- */
function buildDialogPillarOptions() { fillSelect(els.newActionForm.querySelector('select[name="pillar"]'), PILLARS); }
function clampProgress(v) { return Number.isNaN(v) ? 0 : Math.max(0, Math.min(100, Math.round(v))); }
function renderDateInput(f, v) { return `<input data-field="${f}" type="date" value="${v || ""}" />`; }
function renderTextarea(f, v) { return `<textarea data-field="${f}" rows="2">${escapeHtml(v || "")}</textarea>`; }
function renderNumberInput(f, v) { return `<input data-field="${f}" type="number" min="0" max="100" value="${Number(v || 0)}" />`; }
function renderSelect(f, sel, opts) { return `<select data-field="${f}">${opts.map((o) => `<option ${o === sel ? "selected" : ""}>${o}</option>`).join("")}</select>`; }
function renderActivityTagBadge(name) {
  const t = String(name || "").trim(); if (!t) return "";
  return `<span class="id-activity-tag" style="${tagStyle(t)}" title="${escapeHtml(t)}"></span>`;
}
function normalize(v) { return String(v || "").trim().toLowerCase(); }
function tagStyle(name) {
  const n = normalize(name); let h = 0;
  for (let i = 0; i < n.length; i++) { h = (h << 5) - h + n.charCodeAt(i); h |= 0; }
  const hue = Math.abs(h) % 360;
  return `background:hsl(${hue} 80% 92%);color:hsl(${hue} 70% 28%);border-color:hsl(${hue} 70% 72%);`;
}
function escapeHtml(v) {
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
