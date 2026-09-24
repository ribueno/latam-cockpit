"use strict";

// Tableau discovery helper — find view LUIDs and inspect a view's data so you
// can fill in config/cockpit.json (viewId / filters / extract).
//
// Usage:
//   node scripts/tableau-dump.js                       # list all views (id + name)
//   node scripts/tableau-dump.js scorecard             # list views whose name matches "scorecard"
//   node scripts/tableau-dump.js view <VIEW_LUID>      # dump columns + first rows of a view
//   node scripts/tableau-dump.js view <VIEW_LUID> Region=LATAM   # apply filter(s) first
//
// Requires TABLEAU_* env vars (already set in .env).

require("dotenv").config();
const tableau = require("../lib/sources/tableau");

function parseFilters(args) {
  const filters = {};
  for (const a of args) {
    const i = a.indexOf("=");
    if (i > 0) filters[a.slice(0, i)] = a.slice(i + 1);
  }
  return filters;
}

async function main() {
  if (!tableau.isConfigured()) {
    console.error("Tableau not configured — set TABLEAU_HOST/SITE/PAT_NAME/PAT_SECRET in .env");
    process.exit(1);
  }
  const { token, siteId } = await tableau.signIn();
  console.log(`Signed in to Tableau (site ${siteId}) ✓\n`);
  try {
    const [cmd, ...rest] = process.argv.slice(2);

    if (cmd === "graphql") {
      const query = rest.join(" ");
      const res = await fetch(`https://${process.env.TABLEAU_HOST}/api/metadata/graphql`, {
        method: "POST",
        headers: { "X-Tableau-Auth": token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query }),
      });
      console.log(await res.text());
      return;
    }

    if (cmd === "datasources") {
      const dss = await tableau.listDatasources({ token, siteId, needle: rest[0] || "" });
      console.log(`${dss.length} data source(s)${rest[0] ? ` matching "${rest[0]}"` : ""}:\n`);
      for (const d of dss) console.log(`  ${d.id}  ${d.name}  (${d.type})`);
      return;
    }

    if (cmd === "meta") {
      const dsLuid = rest[0];
      if (!dsLuid) { console.error("Usage: node scripts/tableau-dump.js meta <DATASOURCE_LUID>"); process.exit(1); }
      const md = await tableau.vdsReadMetadata({ token, datasourceLuid: dsLuid });
      const fields = md.data || md.fields || md;
      console.log("FIELDS:");
      for (const f of fields) console.log(`  - ${f.fieldCaption || f.fieldName || JSON.stringify(f)}  [${f.dataType || f.logicalTableId || ""}]`);
      return;
    }

    if (cmd === "vds") {
      const dsLuid = rest[0];
      const fields = (rest[1] || "").split(",").filter(Boolean);
      const filters = parseFilters(rest.slice(2));
      if (!dsLuid || !fields.length) {
        console.error('Usage: node scripts/tableau-dump.js vds <DS_LUID> "Field1,Field2" [Location=LATAM]');
        process.exit(1);
      }
      const rows = await tableau.vdsQuery({ token, datasourceLuid: dsLuid, fields, filters });
      console.log(`${rows.length} row(s):`);
      for (const r of rows.slice(0, 20)) console.log("  " + JSON.stringify(r));
      return;
    }

    if (cmd === "view") {
      const viewId = rest[0];
      if (!viewId) { console.error("Usage: node scripts/tableau-dump.js view <VIEW_LUID> [Field=Value ...]"); process.exit(1); }
      const filters = parseFilters(rest.slice(1));
      console.log(`Fetching view ${viewId}${Object.keys(filters).length ? " with filters " + JSON.stringify(filters) : ""}...\n`);
      const csv = await tableau.fetchViewCsv({ token, siteId, viewId, filters });
      const rows = tableau.parseCsv(csv);
      if (!rows.length) { console.log("(no rows returned)"); return; }
      console.log("COLUMNS:");
      for (const h of Object.keys(rows[0])) console.log(`  - ${h}`);
      console.log(`\nFIRST ${Math.min(10, rows.length)} ROWS (of ${rows.length}):`);
      for (const r of rows.slice(0, 10)) console.log("  " + JSON.stringify(r));
      return;
    }

    // Default: list views, optional name filter.
    const needle = (cmd || "").toLowerCase();
    const views = await tableau.listViews({ token, siteId });
    const matched = needle
      ? views.filter((v) => `${v.name} ${v.contentUrl}`.toLowerCase().includes(needle))
      : views;
    console.log(`${matched.length} view(s)${needle ? ` matching "${needle}"` : ""} (of ${views.length} total):\n`);
    for (const v of matched.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${v.id}  ${v.name}   [${v.contentUrl}]`);
    }
    if (!needle) console.log(`\nTip: filter by name, e.g. "node scripts/tableau-dump.js scorecard"`);
  } finally {
    await tableau.signOut(token);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
