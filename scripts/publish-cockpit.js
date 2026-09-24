"use strict";

// Standalone weekly KPI cockpit publisher.
//   node scripts/publish-cockpit.js            -> collect + update the Slack canvas
//   node scripts/publish-cockpit.js --dry-run  -> collect + print markdown, no Slack calls
// Ideal as a scheduler job (Fly/Render/Heroku) every Monday morning.

require("dotenv").config();
const kpi = require("../lib/kpi");
const canvas = require("../lib/canvas");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const kpis = await kpi.collectKpis();
  const markdown = kpi.buildCanvasMarkdown(kpis);

  console.log(`\nLATAM KPI cockpit — ${dryRun ? "PREVIEW" : "PUBLISH"} @ ${new Date().toISOString()}\n`);
  console.log(markdown);
  console.log("\n---");
  for (const k of kpis) {
    const flag = k.error ? `ERROR: ${k.error}` : k.note ? `(${k.note})` : `${k.display} [${k.status}]`;
    console.log(`  ${k.label.padEnd(22)} ${flag}`);
  }

  if (!dryRun) {
    const result = await canvas.publishCanvas(markdown, { dryRun: false });
    console.log(`\nCanvas ${result.created ? "created" : "updated"}: ${result.canvasId}`);
    await canvas.pingGm(result.canvasId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
