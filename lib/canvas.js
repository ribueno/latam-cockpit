"use strict";

// Slack canvas publisher for the weekly KPI cockpit.
// Creates the canvas once, then UPDATES IT IN PLACE each week so the GM keeps a
// single stable link. The canvas id is persisted in data/cockpit-state.json.
//
// Slack app scopes required (add in api.slack.com/apps -> OAuth & Permissions):
//   canvases:write, canvases:read   (+ existing chat:write, users:read)
//
// Config (see .env.example):
//   COCKPIT_ENABLED=true
//   COCKPIT_CRON=0 8 * * 1               (default Monday 08:00)
//   COCKPIT_CANVAS_TITLE=LATAM ProServ Weekly Cockpit
//   COCKPIT_GM_SLACK_ID=U0123...         (GM to grant read + optional DM ping)
//   COCKPIT_CHANNEL=C0123...             (optional channel to share the canvas in)

const fs = require("fs");
const path = require("path");
const slack = require("./slack");

const STATE_FILE = path.join(__dirname, "..", "data", "cockpit-state.json");

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function grantAccess(client, canvasId) {
  const userIds = (process.env.COCKPIT_GM_SLACK_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  const channelIds = (process.env.COCKPIT_CHANNEL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!userIds.length && !channelIds.length) return;
  try {
    await client.apiCall("canvases.access.set", {
      canvas_id: canvasId,
      access_level: "read",
      ...(userIds.length ? { user_ids: userIds } : {}),
      ...(channelIds.length ? { channel_ids: channelIds } : {}),
    });
  } catch (err) {
    console.warn("[cockpit] canvas access.set failed:", err.data?.error || err.message);
  }
}

// Create or update the canvas with fresh markdown. Returns { canvasId, created }.
async function publishCanvas(markdown, { dryRun = false } = {}) {
  if (dryRun) return { canvasId: null, created: false, dryRun: true, markdown };

  const client = slack.getClient();
  const title = process.env.COCKPIT_CANVAS_TITLE || "LATAM ProServ Weekly Cockpit";
  const state = readState();
  const content = { type: "markdown", markdown };

  if (state.canvasId) {
    try {
      await client.apiCall("canvases.edit", {
        canvas_id: state.canvasId,
        changes: [{ operation: "replace", document_content: content }],
      });
      return { canvasId: state.canvasId, created: false };
    } catch (err) {
      // Canvas may have been deleted — fall through and recreate.
      console.warn("[cockpit] canvas edit failed, recreating:", err.data?.error || err.message);
    }
  }

  const res = await client.apiCall("canvases.create", { title, document_content: content });
  const canvasId = res.canvas_id;
  await grantAccess(client, canvasId);
  writeState({ ...state, canvasId, createdAt: new Date().toISOString() });
  return { canvasId, created: true };
}

// Optional: DM the GM a link to the canvas after refresh.
async function pingGm(canvasId) {
  const gm = (process.env.COCKPIT_GM_SLACK_ID || "").split(",")[0]?.trim();
  if (!gm || !canvasId) return;
  try {
    const client = slack.getClient();
    const im = await client.conversations.open({ users: gm });
    await client.chat.postMessage({
      channel: im.channel.id,
      text: `:bar_chart: LATAM ProServ weekly cockpit updated — https://slack.com/canvas/${canvasId}`,
    });
  } catch (err) {
    console.warn("[cockpit] GM ping failed:", err.data?.error || err.message);
  }
}

module.exports = { publishCanvas, pingGm, readState, writeState };
