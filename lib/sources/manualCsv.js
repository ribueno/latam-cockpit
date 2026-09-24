"use strict";

// Manual KPI values from a weekly CSV drop. This is the reliable path for the
// Tableau KPIs (the ProServ Scorecard uses embedded data sources that no API can
// read directly), and doubles as a universal override for ANY KPI.
//
// File: data/latam-kpis.csv (override with KPI_CSV_FILE). Format — one row per
// metric, header required:
//
//   key,value,asOf
//   bookings,12500000,2026-09-22
//   revenue,9100000,2026-09-22
//   utilization,78,2026-09-22
//   projectsRed,4,2026-09-22
//
// Valid keys: bookings, revenue, utilization, projectsRed, ari, activation.
// `asOf` is optional (YYYY-MM-DD). Any key present here overrides other sources.

const fs = require("fs");
const path = require("path");
const { parseCsv } = require("./tableau");

function filePath() {
  const f = process.env.KPI_CSV_FILE || "data/latam-kpis.csv";
  return path.isAbsolute(f) ? f : path.join(__dirname, "..", "..", f);
}

function toNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[$,%\s]/g, ""));
  return Number.isNaN(n) ? null : n;
}

// Returns a Map<key, { value, asOf }>. Empty map if the file is absent.
function load() {
  const map = new Map();
  let text;
  try { text = fs.readFileSync(filePath(), "utf8"); }
  catch { return map; }
  for (const row of parseCsv(text)) {
    const key = String(row.key || row.Key || "").trim();
    if (!key) continue;
    map.set(key, { value: toNumber(row.value ?? row.Value), asOf: (row.asOf || row.AsOf || "").trim() || null });
  }
  return map;
}

module.exports = { load, filePath };
