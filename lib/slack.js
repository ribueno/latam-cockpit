"use strict";

const fs = require("fs");
const path = require("path");
const { WebClient } = require("@slack/web-api");
const plan = require("./plan");

const OWNERS_FILE = path.join(__dirname, "..", "slack", "owners.json");

// owners.json maps a plan owner name to a Slack identity.
// { "Robin Gray": { "slackId": "U123..." }, "Cleri Inhauser": { "email": "cleri@salesforce.com" } }
function loadOwnerMap() {
  try {
    const raw = fs.readFileSync(OWNERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const [name, val] of Object.entries(parsed)) {
      map.set(plan.ownerKey(name), val || {});
    }
    return map;
  } catch {
    return new Map();
  }
}

function getClient() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  return new WebClient(token);
}

async function resolveSlackUserId(client, ownerName, mapping) {
  const entry = mapping.get(plan.ownerKey(ownerName)) || {};
  if (entry.slackId) return entry.slackId;
  if (entry.email) {
    try {
      const res = await client.users.lookupByEmail({ email: entry.email });
      if (res.ok && res.user) return res.user.id;
    } catch {
      /* fall through */
    }
  }
  return null;
}

// Send weekly reminders. Returns a structured report; never throws per-owner.
async function sendReminders(actions, { dryRun = false, reference = new Date(), appUrl } = {}) {
  const digests = plan.buildOwnerDigests(actions, { reference });
  const mapping = loadOwnerMap();
  const report = { sentAt: new Date().toISOString(), dryRun, results: [], totals: {} };

  let client = null;
  if (!dryRun) client = getClient();

  for (const digest of digests) {
    const message = plan.buildReminderMessage(digest, { reference, appUrl });
    const row = {
      owner: digest.owner,
      itemCount: digest.items.length,
      status: "pending",
      preview: message,
    };

    if (dryRun) {
      const slackId = mapping.get(plan.ownerKey(digest.owner))?.slackId
        || (mapping.has(plan.ownerKey(digest.owner)) ? "(via email lookup)" : null);
      row.status = slackId ? "would-send" : "unmapped";
      row.target = slackId || null;
      report.results.push(row);
      continue;
    }

    try {
      const userId = await resolveSlackUserId(client, digest.owner, mapping);
      if (!userId) {
        row.status = "unmapped";
        report.results.push(row);
        continue;
      }
      const im = await client.conversations.open({ users: userId });
      const channel = im.channel.id;
      await client.chat.postMessage({
        channel,
        text: `Your LATAM Transformation Plan action items before Wednesday's meeting`,
        mrkdwn: true,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: message } }],
      });
      row.status = "sent";
      row.target = userId;
    } catch (err) {
      row.status = "error";
      row.error = err.data?.error || err.message;
    }
    report.results.push(row);
  }

  report.totals = report.results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  // Optional summary to a control channel.
  if (!dryRun && process.env.SLACK_SUMMARY_CHANNEL && client) {
    try {
      const summary =
        `:calendar: *Weekly LATAM plan reminders sent* — ` +
        Object.entries(report.totals).map(([k, v]) => `${v} ${k}`).join(", ");
      await client.chat.postMessage({
        channel: process.env.SLACK_SUMMARY_CHANNEL,
        text: summary,
      });
    } catch {
      /* non-fatal */
    }
  }

  return report;
}

module.exports = { sendReminders, loadOwnerMap, resolveSlackUserId, getClient };
