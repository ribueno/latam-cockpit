"use strict";

// KPI cockpit orchestrator — the 6 weekly metrics for the LATAM OU GM.
// Pulls each source (Tableau / ARI / ownership matrix), normalizes to a common
// shape, grades status vs. targets, and renders a Slack-canvas markdown doc.
//
// Framework-free (like plan.js) so both the server and the standalone publisher
// script can reuse it.

const fs = require("fs");
const path = require("path");

const tableau = require("./sources/tableau");
const ari = require("./sources/ari");
const ownership = require("./sources/ownership");
const manualCsv = require("./sources/manualCsv");
const ingest = require("./ingest");

// Canonical KPI catalog. `unit` drives formatting; `higherIsBetter` drives grading.
// unit: usd | pct | int | num.  higherIsBetter drives green/red grading.
// Tweak `unit`/`higherIsBetter` here if a metric's shape differs from the guess.
const TABLEAU_SRC = "Tableau · ProServ Scorecard (LATAM)";
const KPIS = [
  { key: "bookings",      label: "Bookings",            unit: "usd", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "revenue",       label: "Revenue",             unit: "usd", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "utilization",   label: "Utilization",         unit: "pct", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "projectsRed",   label: "Projects in Red",     unit: "int", higherIsBetter: false, source: TABLEAU_SRC },
  { key: "bench",         label: "Bench",               unit: "pct", higherIsBetter: false, source: TABLEAU_SRC },
  { key: "headcount",     label: "Headcount",           unit: "int", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "gdcUsage",      label: "GDC Usage",           unit: "pct", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "tmBillRate",    label: "T&M Bill Rate",       unit: "usd", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "deliveryMargin",label: "Delivery Margin",     unit: "pct", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "pipeGen",       label: "Pipe Gen",            unit: "usd", higherIsBetter: true,  source: TABLEAU_SRC },
  { key: "ari",           label: "ARI",                 unit: "num", higherIsBetter: true,  source: "Apps Script (ARI)" },
  { key: "activation",    label: "Coworker Activation", unit: "pct", higherIsBetter: true,  source: "Ownership matrix (ProServ owners)" },
];

const CONFIG_PATH = path.join(__dirname, "..", "config", "cockpit.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {}; // no config yet — adapters fall back to "not configured"
  }
}

// ---- Formatting ---------------------------------------------------------
function formatValue(unit, value) {
  if (value == null || Number.isNaN(value)) return "—";
  switch (unit) {
    case "usd": {
      const abs = Math.abs(value);
      if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
      if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
      if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
      return `$${value}`;
    }
    case "pct": return `${Math.round(value)}%`;
    case "int": return String(Math.round(value));
    default:    return String(value);
  }
}

// ---- Grading ------------------------------------------------------------
// Uses per-KPI target + optional yellow band from config.targets[key]:
//   { target: number, yellowBand: 0.1 }   // within 10% of target = yellow
function grade(kpi, value, targetCfg) {
  if (value == null || Number.isNaN(value) || !targetCfg || targetCfg.target == null) return "unknown";
  const { target } = targetCfg;
  const band = targetCfg.yellowBand ?? 0.1;
  const ratio = value / target;
  if (kpi.higherIsBetter) {
    if (ratio >= 1) return "green";
    if (ratio >= 1 - band) return "yellow";
    return "red";
  } else {
    if (value <= target) return "green";
    if (value <= target * (1 + band)) return "yellow";
    return "red";
  }
}

const STATUS_EMOJI = { green: "🟢", yellow: "🟡", red: "🔴", unknown: "⚪️" };

// ---- Collection ---------------------------------------------------------
// Runs every source in parallel; one failing source never breaks the cockpit.
async function collectKpis({ config = loadConfig() } = {}) {
  const tableauKpis = config.tableau?.kpis || [];
  // Tableau REST API is opt-in (TABLEAU_MODE=api). Default is the weekly CSV drop,
  // because the ProServ Scorecard's data sources are embedded (no API can read them).
  const tableauApi = String(process.env.TABLEAU_MODE).toLowerCase() === "api";

  const jobs = [ari.collect(), ownership.collect(config.ownership || {})];
  if (tableauApi) jobs.unshift(tableau.collect(tableauKpis));
  const settledAll = await Promise.allSettled(jobs);

  const raw = new Map();
  for (const settled of settledAll) {
    if (settled.status === "fulfilled") {
      for (const item of settled.value) raw.set(item.key, item);
    }
  }

  // Value precedence: manual CSV (human) > pushed ingest (e.g. ARI) > live adapter.
  const manual = manualCsv.load();
  const pushed = ingest.load();

  const targets = config.targets || {};
  const today = new Date().toISOString().slice(0, 10);

  return KPIS.map((kpi) => {
    const r = raw.get(kpi.key) || {};
    const m = manual.get(kpi.key);
    const p = pushed.get(kpi.key);
    const override = m || p || null;
    const value = override ? override.value : (r.value ?? null);
    const configured = override ? true : r.configured !== false;
    const error = override ? null : r.error || null;
    const note = override ? null : (r.note || (!tableauApi && kpi.source.startsWith("Tableau") ? "Add to data/latam-kpis.csv" : null));
    const sourceSuffix = m ? " · manual CSV" : p ? " · pushed" : "";
    return {
      key: kpi.key,
      label: kpi.label,
      unit: kpi.unit,
      source: kpi.source + sourceSuffix,
      value,
      display: formatValue(kpi.unit, value),
      target: targets[kpi.key]?.target ?? null,
      status: error ? "unknown" : grade(kpi, value, targets[kpi.key]),
      configured,
      note,
      error,
      asOf: override?.asOf || today,
    };
  });
}

// ---- Slack canvas markdown ---------------------------------------------
function buildCanvasMarkdown(kpis, { reference = new Date() } = {}) {
  const dateLabel = reference.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const lines = [];
  lines.push(`# LATAM ProServ Weekly Cockpit`);
  lines.push(`_Week of ${dateLabel}_`);
  lines.push("");
  lines.push(`| KPI | Status | Value | Target | Source |`);
  lines.push(`| --- | :---: | ---: | ---: | --- |`);
  for (const k of kpis) {
    const target = k.target == null ? "—" : formatValue(k.unit, k.target);
    const val = k.error ? `⚠️ ${k.error.slice(0, 40)}` : (k.note && k.value == null ? `_${k.note}_` : k.display);
    lines.push(`| **${k.label}** | ${STATUS_EMOJI[k.status]} | ${val} | ${target} | ${k.source} |`);
  }
  lines.push("");
  const pending = kpis.filter((k) => !k.configured);
  if (pending.length) {
    lines.push(`> ⏳ Awaiting source setup: ${pending.map((k) => k.label).join(", ")}`);
    lines.push("");
  }
  lines.push(`_Auto-updated weekly. Data as of ${kpis[0]?.asOf}._`);
  return lines.join("\n");
}

module.exports = { KPIS, loadConfig, formatValue, grade, collectKpis, buildCanvasMarkdown, STATUS_EMOJI };
