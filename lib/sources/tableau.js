"use strict";

// Tableau Cloud REST API adapter for the ProServ Scorecard (Weekly Details).
// Feeds KPIs 1-4: Bookings, Revenue, Utilization, Projects in Red — LATAM only.
//
// Auth uses a Personal Access Token (PAT), NOT SSO, so it works from a headless
// server (Fly/Render/Heroku). Create the PAT in Tableau Cloud:
//   Account Settings -> Personal Access Tokens -> New Token
// Then set env vars (see .env.example):
//   TABLEAU_HOST=prod-uswest-c.online.tableau.com
//   TABLEAU_SITE=salesforce                (site contentUrl, from the /site/<X>/ URL)
//   TABLEAU_PAT_NAME=<token name>
//   TABLEAU_PAT_SECRET=<token secret>
//   TABLEAU_API_VERSION=3.19               (optional)
//
// Which numbers to read from the view is config-driven — see config/cockpit.json
// (copy config/cockpit.example.json). Each KPI maps to a view LUID + how to pick
// the value out of the returned CSV, plus the LATAM filter to apply.

const API_VERSION = process.env.TABLEAU_API_VERSION || "3.19";

function host() {
  return process.env.TABLEAU_HOST || "";
}

function baseUrl() {
  return `https://${host()}/api/${API_VERSION}`;
}

function isConfigured() {
  return Boolean(
    host() &&
      process.env.TABLEAU_SITE &&
      process.env.TABLEAU_PAT_NAME &&
      process.env.TABLEAU_PAT_SECRET
  );
}

// Sign in with the PAT; returns { token, siteId }.
async function signIn() {
  const res = await fetch(`${baseUrl()}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      credentials: {
        personalAccessTokenName: process.env.TABLEAU_PAT_NAME,
        personalAccessTokenSecret: process.env.TABLEAU_PAT_SECRET,
        site: { contentUrl: process.env.TABLEAU_SITE },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Tableau sign-in failed (${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  return { token: body.credentials.token, siteId: body.credentials.site.id };
}

async function signOut(token) {
  try {
    await fetch(`${baseUrl()}/auth/signout`, {
      method: "POST",
      headers: { "X-Tableau-Auth": token },
    });
  } catch {
    /* non-fatal */
  }
}

// Fetch a view's underlying data as CSV. `filters` is a map of
// { "Field Name": "Value" } applied as vf_<Field>=<Value> parameters — this is
// how we scope to LATAM (e.g. { Region: "LATAM" }).
async function fetchViewCsv({ token, siteId, viewId, filters = {} }) {
  const params = new URLSearchParams({ maxAge: "5" });
  for (const [field, value] of Object.entries(filters)) {
    params.set(`vf_${field}`, value);
  }
  const url = `${baseUrl()}/sites/${siteId}/views/${viewId}/data?${params.toString()}`;
  const res = await fetch(url, { headers: { "X-Tableau-Auth": token, Accept: "text/csv, */*" } });
  if (!res.ok) {
    throw new Error(`Tableau view data failed (${res.status}): ${await res.text()}`);
  }
  return res.text();
}

// List all views on the site the token can access. Returns
// [{ id, name, contentUrl, workbook }]. Paginates automatically.
async function listViews({ token, siteId }) {
  const out = [];
  let pageNumber = 1;
  const pageSize = 1000;
  for (;;) {
    const url = `${baseUrl()}/sites/${siteId}/views?pageSize=${pageSize}&pageNumber=${pageNumber}`;
    const res = await fetch(url, { headers: { "X-Tableau-Auth": token, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Tableau list views failed (${res.status}): ${await res.text()}`);
    const body = await res.json();
    const views = body.views?.view || [];
    for (const v of views) {
      out.push({ id: v.id, name: v.name, contentUrl: v.contentUrl, workbook: v.workbook?.id });
    }
    const total = Number(body.pagination?.totalAvailable || out.length);
    if (out.length >= total || views.length === 0) break;
    pageNumber++;
  }
  return out;
}

// List published data sources whose name contains `needle` (server-side filter,
// fast). Returns [{ id, name, type }].
async function listDatasources({ token, siteId, needle }) {
  const filter = needle ? `&filter=${encodeURIComponent(`name:has:${needle}`)}` : "";
  const url = `${baseUrl()}/sites/${siteId}/datasources?pageSize=1000${filter}`;
  const res = await fetch(url, { headers: { "X-Tableau-Auth": token, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Tableau list datasources failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return (body.datasources?.datasource || []).map((d) => ({ id: d.id, name: d.name, type: d.type }));
}

// ---- VizQL Data Service (VDS) ------------------------------------------
// Reads fields available on a published data source.
async function vdsReadMetadata({ token, datasourceLuid }) {
  const res = await fetch(`https://${host()}/api/v1/vizql-data-service/read-metadata`, {
    method: "POST",
    headers: { "X-Tableau-Auth": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ datasource: { datasourceLuid } }),
  });
  if (!res.ok) throw new Error(`VDS read-metadata failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Query a published data source. `fields` = ["Bookings", "Revenue", ...];
// `filters` = { "Location": "LATAM" }. Returns array of row objects.
async function vdsQuery({ token, datasourceLuid, fields, filters = {} }) {
  const query = {
    fields: fields.map((f) => (typeof f === "string" ? { fieldCaption: f } : f)),
    filters: Object.entries(filters).map(([field, value]) => ({
      field: { fieldCaption: field },
      filterType: "SET",
      values: Array.isArray(value) ? value : [value],
      exclude: false,
    })),
  };
  const res = await fetch(`https://${host()}/api/v1/vizql-data-service/query-datasource`, {
    method: "POST",
    headers: { "X-Tableau-Auth": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ datasource: { datasourceLuid }, query }),
  });
  if (!res.ok) throw new Error(`VDS query failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return body.data || [];
}

// Minimal CSV parser (handles quoted fields + commas). Returns array of objects
// keyed by header. Good enough for Tableau crosstab/data exports.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function toNumber(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[$,%\s]/g, "").replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

// Pull a single value out of parsed CSV per a spec:
//   { measureColumn: "Bookings", where: { "Measure Names": "Bookings" }, agg: "first"|"sum"|"count" }
function extractValue(rows, spec) {
  let matched = rows;
  if (spec.where) {
    matched = rows.filter((r) =>
      Object.entries(spec.where).every(([k, v]) => String(r[k]).trim() === String(v).trim())
    );
  }
  if (!matched.length) return null;
  const col = spec.measureColumn;
  if (spec.agg === "count") return matched.length;
  if (spec.agg === "sum") return matched.reduce((s, r) => s + (toNumber(r[col]) || 0), 0);
  return toNumber(matched[0][col]); // "first" (default)
}

// Collect the Tableau-sourced KPIs. `mappings` comes from config/cockpit.json
// under `tableau.kpis` — an array of { key, label, viewId, filters, extract, unit, target }.
// Returns an array of normalized KPI objects (see lib/kpi.js).
async function collect(mappings = []) {
  if (!isConfigured()) {
    return mappings.map((m) => ({
      key: m.key,
      configured: false,
      note: "Tableau not configured — set TABLEAU_* env vars + config/cockpit.json",
    }));
  }
  const { token, siteId } = await signIn();
  try {
    const out = [];
    // Cache CSV per viewId+filters so we don't refetch the same view per measure.
    const cache = new Map();
    for (const m of mappings) {
      try {
        const cacheKey = `${m.viewId}|${JSON.stringify(m.filters || {})}`;
        if (!cache.has(cacheKey)) {
          const csv = await fetchViewCsv({ token, siteId, viewId: m.viewId, filters: m.filters || {} });
          cache.set(cacheKey, parseCsv(csv));
        }
        const value = extractValue(cache.get(cacheKey), m.extract || {});
        out.push({ key: m.key, value, configured: true });
      } catch (err) {
        out.push({ key: m.key, configured: true, error: err.message });
      }
    }
    return out;
  } finally {
    await signOut(token);
  }
}

module.exports = {
  isConfigured, signIn, signOut, listViews, listDatasources,
  vdsReadMetadata, vdsQuery, fetchViewCsv, parseCsv, extractValue, collect,
};
