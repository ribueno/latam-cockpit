"use strict";

// Standalone weekly reminder runner.
//   node scripts/send-reminders.js            -> send for real
//   node scripts/send-reminders.js --dry-run  -> preview only (no Slack calls)
// Ideal as a Heroku Scheduler job ("node scripts/send-reminders.js") every Monday morning.

require("dotenv").config();
const store = require("../lib/store");
const slack = require("../lib/slack");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const actions = store.readActions();
  const report = await slack.sendReminders(actions, {
    dryRun,
    appUrl: process.env.APP_URL,
  });

  console.log(`\nLATAM weekly reminders — ${dryRun ? "PREVIEW" : "SEND"} @ ${report.sentAt}`);
  console.log("Totals:", report.totals);
  for (const r of report.results) {
    console.log(`\n— ${r.owner} [${r.status}${r.target ? " -> " + r.target : ""}] (${r.itemCount} items)`);
    if (dryRun) console.log(r.preview.split("\n").map((l) => "   " + l).join("\n"));
    if (r.error) console.log("   ERROR:", r.error);
  }
  if (!dryRun && report.totals.error) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
