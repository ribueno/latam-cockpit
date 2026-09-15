"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const cron = require("node-cron");

const store = require("./lib/store");
const plan = require("./lib/plan");
const slack = require("./lib/slack");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const APP_USERNAME = process.env.APP_USERNAME || "denise";
const APP_PASSWORD = process.env.APP_PASSWORD || "change-me-please";

app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "latam-cockpit-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 12 },
  })
);

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL;
  return `${req.protocol}://${req.get("host")}`;
}

// ---- Auth helpers -------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ ok: false, error: "unauthorized" });
  return res.redirect("/login");
}

// ---- Public routes ------------------------------------------------------
app.get("/login", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "login.html")));

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === APP_USERNAME && password === APP_PASSWORD) {
    req.session.user = { username };
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "invalid credentials" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Static assets that are safe pre-auth (logo, login styles are inline).
app.use("/assets", express.static(path.join(PUBLIC_DIR, "assets")));

// ---- Protected app ------------------------------------------------------
app.get("/", requireAuth, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/styles.css", requireAuth, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "styles.css")));
app.get("/app.js", requireAuth, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.js")));

// ---- Actions API --------------------------------------------------------
app.get("/api/actions", requireAuth, async (_req, res) => {
  try {
    const actions = await store.readActions();
    res.json({ ok: true, actions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/actions", requireAuth, async (req, res) => {
  const incoming = req.body?.action;
  if (!incoming || !incoming.pillar) return res.status(400).json({ ok: false, error: "invalid action" });
  try {
    const actions = await store.readActions();
    const pillarIndex = plan.PILLARS.indexOf(incoming.pillar);
    const action = {
      id: incoming.id || store.nextId(actions, pillarIndex),
      pillar: incoming.pillar,
      action: incoming.action || "",
      description: incoming.description || "",
      progressText: incoming.progressText || "",
      owner: plan.normalizeOwner(incoming.owner),
      dueDate: incoming.dueDate || "",
      status: incoming.status || "Not Started",
      progress: clampProgress(incoming.progress),
      helpNeeded: incoming.helpNeeded || "",
      horizon: Number(incoming.horizon) || 90,
      lastUpdate: store.todayDate(),
    };
    actions.push(action);
    await store.writeActions(actions);
    res.json({ ok: true, action });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/actions/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  const incoming = req.body?.action;
  try {
    const actions = await store.readActions();
    const idx = actions.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: "not found" });
    actions[idx] = {
      ...actions[idx],
      ...incoming,
      id,
      owner: plan.normalizeOwner(incoming.owner ?? actions[idx].owner),
      progress: clampProgress(incoming.progress ?? actions[idx].progress),
      lastUpdate: store.todayDate(),
    };
    await store.writeActions(actions);
    res.json({ ok: true, action: actions[idx] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/actions/:id", requireAuth, async (req, res) => {
  try {
    const actions = (await store.readActions()).filter((a) => a.id !== req.params.id);
    await store.writeActions(actions);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Backups ------------------------------------------------------------
app.get("/api/backups/meta", requireAuth, (_req, res) => {
  res.json({ ok: true, lastBackupAt: store.getLastBackupAt() });
});

app.get("/api/backups/latest", requireAuth, async (_req, res) => {
  try {
    const actions = await store.readActions();
    const buffer = await store.backupBuffer(actions);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="latam-plan-backup-${stamp}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Slack reminders API ------------------------------------------------
app.get("/api/reminders/config", requireAuth, async (_req, res) => {
  try {
    const mapping = slack.loadOwnerMap();
    const actions = await store.readActions();
    const owners = [...new Set(actions.map((a) => plan.normalizeOwner(a.owner)).filter(Boolean))];
    res.json({
      ok: true,
      cron: process.env.REMINDER_CRON || "0 8 * * 1",
      tz: process.env.REMINDER_TZ || "America/New_York",
      enabled: String(process.env.REMINDER_ENABLED).toLowerCase() === "true",
      slackConfigured: Boolean(process.env.SLACK_BOT_TOKEN),
      nextMeeting: plan.nextMeetingDate().toISOString().slice(0, 10),
      owners: owners.map((o) => ({
        owner: o,
        mapped: mapping.has(plan.ownerKey(o)),
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/reminders/preview", requireAuth, async (req, res) => {
  try {
    const actions = await store.readActions();
    const report = await slack.sendReminders(actions, { dryRun: true, appUrl: appUrl(req) });
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/reminders/send", requireAuth, async (req, res) => {
  if (!process.env.SLACK_BOT_TOKEN) {
    return res.status(400).json({ ok: false, error: "SLACK_BOT_TOKEN not configured" });
  }
  try {
    const actions = await store.readActions();
    const report = await slack.sendReminders(actions, { dryRun: false, appUrl: appUrl(req) });
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Helpers ------------------------------------------------------------
function clampProgress(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---- Weekly cron --------------------------------------------------------
function scheduleReminders() {
  const expr = process.env.REMINDER_CRON || "0 8 * * 1";
  const tz = process.env.REMINDER_TZ || "America/New_York";
  const enabled = String(process.env.REMINDER_ENABLED).toLowerCase() === "true";
  if (!cron.validate(expr)) {
    console.warn(`[reminders] invalid REMINDER_CRON "${expr}" — skipping schedule`);
    return;
  }
  cron.schedule(
    expr,
    async () => {
      const dryRun = !enabled || !process.env.SLACK_BOT_TOKEN;
      console.log(`[reminders] cron fired (${dryRun ? "preview" : "send"}) @ ${new Date().toISOString()}`);
      try {
        const actions = await store.readActions();
        const report = await slack.sendReminders(actions, {
          dryRun,
          appUrl: process.env.APP_URL,
        });
        console.log(`[reminders] result:`, JSON.stringify(report.totals));
      } catch (err) {
        console.error(`[reminders] failed:`, err.message);
      }
    },
    { timezone: tz }
  );
  console.log(`[reminders] scheduled "${expr}" (${tz}), enabled=${enabled}`);
}

app.listen(PORT, async () => {
  store.ensureDirs();
  // Pre-hydrate the store so the first request is fast
  await store.readActions();
  console.log(`LATAM cockpit running on http://localhost:${PORT}`);
  scheduleReminders();
});
