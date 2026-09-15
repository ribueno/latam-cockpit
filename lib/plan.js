"use strict";

// Domain model for the LATAM ProServ Transformation Plan cockpit.
// Kept framework-free so both the web server and the Slack job can reuse it.

const PILLARS = [
  "Build Foundation",
  "Proactive Attrition Prevention",
  "Reactive Attrition Recovery",
  "Proactive Consumption Booster",
  "Pre-Sales",
];

const STATUSES = ["Not Started", "In Progress", "Blocked", "Completed"];

// Statuses that still represent open work owners must act on.
const OPEN_STATUSES = ["Not Started", "In Progress", "Blocked"];

// The governance meeting runs every Wednesday (day 3, Sun=0).
const MEETING_WEEKDAY = 3;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Next Wednesday on/after the reference date (today counts if it is Wednesday).
function nextMeetingDate(reference = new Date()) {
  const d = startOfDay(reference);
  const delta = (MEETING_WEEKDAY - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function isOpen(action) {
  return OPEN_STATUSES.includes(action.status);
}

function isOverdue(action, reference = new Date()) {
  return isOpen(action) && action.dueDate && new Date(action.dueDate) < startOfDay(reference);
}

// True when the action needs attention *before* the upcoming Wednesday meeting:
// open, and either overdue or due on/before the next meeting date.
function isDueBeforeMeeting(action, reference = new Date()) {
  if (!isOpen(action)) return false;
  if (!action.dueDate) return false;
  const due = startOfDay(action.dueDate);
  return due <= nextMeetingDate(reference);
}

// Urgency bucket used for sorting and colour coding.
function urgency(action, reference = new Date()) {
  if (!isOpen(action)) return "done";
  if (isOverdue(action, reference)) return "overdue";
  if (action.status === "Blocked") return "blocked";
  if (isDueBeforeMeeting(action, reference)) return "due-soon";
  return "later";
}

const URGENCY_RANK = { overdue: 0, blocked: 1, "due-soon": 2, later: 3, done: 4 };

function normalizeOwner(owner) {
  return String(owner || "").trim();
}

function ownerKey(owner) {
  return normalizeOwner(owner).toLowerCase();
}

// Group the open, act-now items by owner for the weekly reminder.
// includeAllOpen=false -> only items due before the meeting (default weekly digest)
// includeAllOpen=true  -> every open item the owner holds
function buildOwnerDigests(actions, { reference = new Date(), includeAllOpen = false } = {}) {
  const byOwner = new Map();
  for (const action of actions) {
    if (!isOpen(action)) continue;
    if (!includeAllOpen && !isDueBeforeMeeting(action, reference) && !isOverdue(action, reference)) {
      continue;
    }
    const key = ownerKey(action.owner);
    if (!key) continue;
    if (!byOwner.has(key)) {
      byOwner.set(key, { owner: normalizeOwner(action.owner), items: [] });
    }
    byOwner.get(key).items.push(action);
  }
  for (const digest of byOwner.values()) {
    digest.items.sort((a, b) => {
      const ua = URGENCY_RANK[urgency(a, reference)];
      const ub = URGENCY_RANK[urgency(b, reference)];
      if (ua !== ub) return ua - ub;
      return String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
    });
  }
  return [...byOwner.values()].sort((a, b) => a.owner.localeCompare(b.owner));
}

function fmtDate(value) {
  if (!value) return "no due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Build the Slack message (mrkdwn) sent to a single owner.
function buildReminderMessage(digest, { reference = new Date(), appUrl } = {}) {
  const meeting = fmtDate(nextMeetingDate(reference));
  const lines = [];
  lines.push(`:wave: *Good morning, ${digest.owner.split(" ")[0]}!*`);
  lines.push(
    `Here are your *LATAM Transformation Plan* action items to update before Wednesday's (${meeting}) governance meeting:`
  );
  lines.push("");
  for (const item of digest.items) {
    const u = urgency(item, reference);
    const flag =
      u === "overdue" ? ":red_circle: *OVERDUE*" :
      u === "blocked" ? ":large_orange_circle: *BLOCKED*" :
      ":large_blue_circle: Due";
    lines.push(`${flag} — *${item.action}*  _(due ${fmtDate(item.dueDate)}, ${item.progress || 0}% • ${item.pillar})_`);
    if (item.helpNeeded && item.helpNeeded.trim()) {
      lines.push(`     :sos: Help needed: ${item.helpNeeded.trim()}`);
    }
  }
  lines.push("");
  lines.push(
    appUrl
      ? `Please update status/progress in the cockpit before Monday EOD: ${appUrl}`
      : `Please update status/progress in the cockpit before Monday EOD.`
  );
  return lines.join("\n");
}

module.exports = {
  PILLARS,
  STATUSES,
  OPEN_STATUSES,
  MEETING_WEEKDAY,
  startOfDay,
  nextMeetingDate,
  isOpen,
  isOverdue,
  isDueBeforeMeeting,
  urgency,
  normalizeOwner,
  ownerKey,
  buildOwnerDigests,
  buildReminderMessage,
  fmtDate,
};
