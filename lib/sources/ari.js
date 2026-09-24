"use strict";

// ARI adapter (KPI 5). Source is a Google Apps Script web app (/exec) that
// currently returns an HTML dashboard.
//
// IMPORTANT ACCESS NOTE: this server is headless (no Salesforce SSO identity).
// A normal Apps Script /exec deployed "Only myself / anyone within Salesforce"
// requires a Google login the server cannot perform. Two ways to make it work:
//
//   (A) Preferred — add a JSON mode to YOUR Apps Script and deploy it with
//       access "Anyone" (or "Anyone with the link"), guarded by a shared secret:
//         function doGet(e){
//           if (e.parameter.key !== SECRET) return ContentService
//             .createTextOutput('forbidden').setMimeType(ContentService.MimeType.TEXT);
//           if (e.parameter.format === 'json') return ContentService
//             .createTextOutput(JSON.stringify({ ari: computeAri() }))
//             .setMimeType(ContentService.MimeType.JSON);
//           /* ...existing HTML... */
//         }
//       Then set ARI_URL to the /exec URL and ARI_KEY to the secret.
//
//   (B) Fallback — scrape the HTML. Brittle; set ARI_VALUE_REGEX to capture the
//       number. Breaks whenever the page markup changes.
//
// Config:
//   ARI_URL=https://script.google.com/a/macros/salesforce.com/s/.../exec
//   ARI_KEY=<shared secret if you added one>
//   ARI_MODE=json | html        (default: json)
//   ARI_JSON_PATH=ari           (dot-path into the JSON response, default "ari")
//   ARI_VALUE_REGEX=ARI[^0-9]*([0-9.]+)   (only for html mode)

function mode() {
  return (process.env.ARI_MODE || "json").toLowerCase();
}

// PULL is active only for json/html modes. Any other value (e.g. "push", "off")
// means ARI arrives via /api/kpis/ingest, so this adapter stays out of the way.
function isConfigured() {
  return Boolean(process.env.ARI_URL) && ["json", "html"].includes(mode());
}

function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

async function collect() {
  if (!isConfigured()) {
    const note = process.env.ARI_URL
      ? "Awaiting weekly push from Apps Script (POST /api/kpis/ingest)"
      : "ARI not configured — push via /api/kpis/ingest or set ARI_URL for pull";
    return [{ key: "ari", configured: false, note }];
  }
  const m = mode();
  const url = new URL(process.env.ARI_URL);
  if (process.env.ARI_KEY) url.searchParams.set("key", process.env.ARI_KEY);
  if (m === "json") url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString(), { redirect: "follow" });
    const text = await res.text();
    if (!res.ok) throw new Error(`ARI fetch failed (${res.status})`);

    if (m === "json") {
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error("ARI response was not JSON (login wall or HTML returned?) — see lib/sources/ari.js"); }
      const value = getByPath(json, process.env.ARI_JSON_PATH || "ari");
      return [{ key: "ari", value: Number(value), configured: true, raw: json }];
    }

    // html mode
    const rx = new RegExp(process.env.ARI_VALUE_REGEX || "ARI[^0-9]*([0-9.]+)");
    const match = text.match(rx);
    if (!match) throw new Error("ARI value not found in HTML — adjust ARI_VALUE_REGEX");
    return [{ key: "ari", value: Number(match[1]), configured: true }];
  } catch (err) {
    return [{ key: "ari", configured: true, error: err.message }];
  }
}

module.exports = { isConfigured, collect };
