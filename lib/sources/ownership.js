"use strict";

// Coworker Activation adapter (KPI 6).
// Source: the "Coworker Activation — Owners by Leader" HTML (Slack file
// F0C53JKR5UY / coworker-activation-owners-by-leader.html). The account data is
// embedded as JSON in <script type="application/json" id="play1Data">...</script>.
// Each row: { name, country, leader, act, ownerName, aov, activated, ... }.
//
// Metric = activated ProServ rows / total ProServ rows (%), where a row belongs
// to ProServ when its `act` field matches. The file is already LATAM-scoped.
//
// Source resolution (first that is set wins):
//   OWNERSHIP_SLACK_FILE_ID=F0C53JKR5UY   -> download weekly via Slack bot token (files:read)
//   OWNERSHIP_URL=https://.../file.html
//   OWNERSHIP_FILE=data/coworker-activation.html   (default; committed copy is gitignored)
//
// Config (config/cockpit.json -> ownership), with sensible defaults:
//   dataScriptId: "play1Data"
//   ownerField:   "act"
//   proServMatch: ["ProServ"]
//   activatedField: "activated"
//   activatedTrue:  [true, "true", "Yes", "Activated"]

const fs = require("fs");
const path = require("path");

function isConfigured() {
  return Boolean(process.env.OWNERSHIP_SLACK_FILE_ID || process.env.OWNERSHIP_URL || process.env.OWNERSHIP_FILE);
}

async function loadHtml() {
  if (process.env.OWNERSHIP_SLACK_FILE_ID) {
    const slack = require("../slack");
    const client = slack.getClient();
    const info = await client.files.info({ file: process.env.OWNERSHIP_SLACK_FILE_ID });
    const url = info.file?.url_private_download || info.file?.url_private;
    if (!url) throw new Error("Slack file has no download URL (files:read + access needed)");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
    if (!res.ok) throw new Error(`Slack file download failed (${res.status})`);
    return res.text();
  }
  if (process.env.OWNERSHIP_URL) {
    const res = await fetch(process.env.OWNERSHIP_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`Ownership file fetch failed (${res.status})`);
    return res.text();
  }
  const p = path.isAbsolute(process.env.OWNERSHIP_FILE)
    ? process.env.OWNERSHIP_FILE
    : path.join(__dirname, "..", "..", process.env.OWNERSHIP_FILE);
  return fs.readFileSync(p, "utf8");
}

// Pull the embedded JSON account rows.
function extractRows(html, scriptId) {
  const rx = new RegExp(`<script[^>]*id="${scriptId}"[^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const m = html.match(rx);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); }
  catch { return null; }
}

function isActivated(row, field, trueVals) {
  const v = row[field];
  if (typeof v === "boolean") return v === true;
  return trueVals.map((x) => String(x).toLowerCase()).includes(String(v).toLowerCase());
}

async function collect(cfg = {}) {
  if (!isConfigured()) {
    return [{ key: "activation", configured: false, note: "Set OWNERSHIP_SLACK_FILE_ID / OWNERSHIP_URL / OWNERSHIP_FILE" }];
  }
  const scriptId = cfg.dataScriptId || "play1Data";
  const ownerField = cfg.ownerField || "act";
  const proServMatch = (cfg.proServMatch || ["ProServ"]).map((s) => s.toLowerCase());
  const activatedField = cfg.activatedField || "activated";
  const activatedTrue = cfg.activatedTrue || [true, "true", "Yes", "Activated"];

  try {
    const html = await loadHtml();
    const rows = extractRows(html, scriptId);
    if (!rows || !rows.length) {
      throw new Error(`No rows in <script id="${scriptId}"> — check dataScriptId/source`);
    }
    const proServ = rows.filter((r) =>
      proServMatch.some((m) => String(r[ownerField] || "").toLowerCase().includes(m))
    );
    if (!proServ.length) {
      return [{ key: "activation", configured: true, value: 0, note: `0 ProServ rows matched on '${ownerField}'` }];
    }
    const activated = proServ.filter((r) => isActivated(r, activatedField, activatedTrue));
    const value = Math.round((activated.length / proServ.length) * 100);
    return [{
      key: "activation",
      value,
      configured: true,
      extra: { proServTotal: proServ.length, proServActivated: activated.length },
    }];
  } catch (err) {
    return [{ key: "activation", configured: true, error: err.message }];
  }
}

module.exports = { isConfigured, extractRows, collect };
