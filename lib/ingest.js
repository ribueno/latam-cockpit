"use strict";

// Ingest store for KPI values PUSHED into the cockpit (e.g. the ARI Apps Script
// posting on a weekly trigger). Persisted to data/kpi-ingest.json.
//
// Precedence in lib/kpi.js: manual CSV > ingest (push) > live adapters.
// Note: on ephemeral hosts (Fly/Render/Heroku) this file resets on redeploy —
// that's fine because the weekly push refills it before the canvas is published.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "kpi-ingest.json");

function load() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, "utf8"))));
  } catch {
    return new Map();
  }
}

function save(map) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(map), null, 2));
}

function set(key, value, asOf) {
  const map = load();
  const n = Number(String(value).replace(/[$,%\s]/g, ""));
  map.set(key, { value: Number.isNaN(n) ? null : n, asOf: asOf || null, receivedAt: new Date().toISOString() });
  save(map);
  return map.get(key);
}

module.exports = { load, set, FILE };
