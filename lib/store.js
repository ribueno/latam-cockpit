"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

// ─── GitHub persistence ──────────────────────────────────────────────────────
// When GITHUB_TOKEN is set the app reads/writes data/actions.json directly
// in the GitHub repo via the Contents API.  Every write creates one commit
// so you get a full edit history for free.
//
// When GITHUB_TOKEN is NOT set (local dev) the app falls back to the local
// ./data/actions.json file, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO  || "ribueno/latam-cockpit";
const GITHUB_FILE  = "data/actions.json";
const GITHUB_API   = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

// Local fallback paths (used when GITHUB_TOKEN is absent)
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const ACTIONS_FILE = path.join(DATA_DIR, "actions.json");
const BACKUP_DIR   = path.join(DATA_DIR, "backups");

// In-memory store: { actions: [], sha: null }
// sha is the GitHub blob SHA needed for every PUT — kept in sync automatically.
let _mem = null;
let lastBackupAt = null;

// ─── Local helpers ───────────────────────────────────────────────────────────

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(ACTIONS_FILE)) {
    // seed from bundled data on first boot
    const seed = path.join(__dirname, "..", "data", "actions.json");
    if (seed !== ACTIONS_FILE && fs.existsSync(seed)) fs.copyFileSync(seed, ACTIONS_FILE);
  }
}

function _readLocalActions() {
  try {
    const raw = fs.readFileSync(ACTIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.actions) ? parsed.actions : [];
  } catch {
    return [];
  }
}

function _writeLocalActions(actions) {
  ensureDirs();
  fs.writeFileSync(
    ACTIONS_FILE,
    JSON.stringify({ actions, ok: true }, null, 2),
    "utf8"
  );
}

// ─── GitHub API helpers ──────────────────────────────────────────────────────

function _ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "latam-cockpit",
    "Content-Type": "application/json",
  };
}

async function _githubRead() {
  const res = await fetch(GITHUB_API, { headers: _ghHeaders() });
  if (!res.ok) throw new Error(`GitHub GET ${res.status} ${res.statusText}`);
  const data = await res.json();
  const text = Buffer.from(data.content, "base64").toString("utf8");
  const parsed = JSON.parse(text);
  return {
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    sha: data.sha,
  };
}

async function _githubWrite(actions) {
  const content = Buffer.from(
    JSON.stringify({ actions, ok: true }, null, 2) + "\n"
  ).toString("base64");

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const body = {
    message: `auto-save ${stamp} UTC`,
    content,
    sha: _mem?.sha,
  };

  let res = await fetch(GITHUB_API, {
    method: "PUT",
    headers: _ghHeaders(),
    body: JSON.stringify(body),
  });

  // 409 = SHA conflict (another commit landed since our last read) — fetch fresh SHA and retry
  if (res.status === 409) {
    console.warn("[store] GitHub SHA conflict — refreshing and retrying");
    const fresh = await _githubRead();
    body.sha = fresh.sha;
    res = await fetch(GITHUB_API, {
      method: "PUT",
      headers: _ghHeaders(),
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${res.status}: ${err.message || res.statusText}`);
  }

  const data = await res.json();
  // Update cached SHA so next write uses the new blob SHA
  if (_mem) _mem.sha = data.content.sha;
  console.log(`[store] auto-saved to GitHub (${stamp})`);
}

// ─── Hydration ───────────────────────────────────────────────────────────────

async function _hydrate() {
  if (GITHUB_TOKEN) {
    try {
      const { actions, sha } = await _githubRead();
      _mem = { actions, sha };
      console.log(`[store] loaded ${actions.length} actions from GitHub`);
    } catch (e) {
      console.warn("[store] GitHub read failed, falling back to local file:", e.message);
      _mem = { actions: _readLocalActions(), sha: null };
    }
  } else {
    _mem = { actions: _readLocalActions(), sha: null };
    console.log(`[store] loaded ${_mem.actions.length} actions from local file`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the current actions array.
 * Lazily hydrates from GitHub (or local file) on first call.
 */
async function readActions() {
  if (!_mem) await _hydrate();
  return _mem.actions;
}

/**
 * Persists the actions array.
 * Updates the in-memory store immediately, then pushes to GitHub (or local file).
 */
async function writeActions(actions) {
  if (!_mem) _mem = { actions: [], sha: null };
  _mem.actions = actions;

  if (GITHUB_TOKEN) {
    try {
      await _githubWrite(actions);
    } catch (e) {
      // Log but don't crash the request — in-memory state is still updated
      console.error("[store] GitHub write failed:", e.message);
    }
  } else {
    _writeLocalActions(actions);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextId(actions, pillarIndex) {
  const prefix = `P${pillarIndex >= 0 ? pillarIndex + 1 : 9}`;
  const seq = actions.filter((a) => String(a.id || "").startsWith(prefix)).length + 1;
  return `${prefix}-${String(seq).padStart(2, "0")}`;
}

const COLUMNS = [
  { header: "ID",             key: "id",           width: 12 },
  { header: "Pillar",         key: "pillar",        width: 28 },
  { header: "Activity",       key: "action",        width: 40 },
  { header: "Description",    key: "description",   width: 45 },
  { header: "Progress Notes", key: "progressText",  width: 45 },
  { header: "Help Needed",    key: "helpNeeded",    width: 35 },
  { header: "Owner",          key: "owner",         width: 20 },
  { header: "Due Date",       key: "dueDate",       width: 14 },
  { header: "Status",         key: "status",        width: 14 },
  { header: "Live Status",    key: "liveStatus",    width: 40 },
  { header: "Progress %",     key: "progress",      width: 12 },
  { header: "Last Update",    key: "lastUpdate",    width: 14 },
];

async function buildBackupWorkbook(actions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LATAM Cockpit";
  wb.created = new Date();
  const ws = wb.addWorksheet("Activity Plan");
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FF0176D3" },
  };
  actions.forEach((a) => ws.addRow(a));
  return wb;
}

async function writeBackup(actions) {
  ensureDirs();
  const wb = await buildBackupWorkbook(actions);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUP_DIR, `backup-${stamp}.xlsx`);
  await wb.xlsx.writeFile(file);
  lastBackupAt = new Date().toISOString();
  return file;
}

async function backupBuffer(actions) {
  const wb = await buildBackupWorkbook(actions);
  lastBackupAt = new Date().toISOString();
  return wb.xlsx.writeBuffer();
}

function getLastBackupAt() { return lastBackupAt; }

module.exports = {
  readActions,
  writeActions,
  todayDate,
  nextId,
  writeBackup,
  backupBuffer,
  getLastBackupAt,
  ensureDirs,
};
