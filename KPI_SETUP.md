# Weekly KPI Cockpit — Setup Guide

The cockpit pulls **6 KPIs** for the LATAM OU GM and publishes a **Slack canvas**
that refreshes weekly (updated in place, so the GM keeps one stable link).

| # | KPI (csv key) | Source | Adapter |
|---|-----|--------|---------|
| 1 | Bookings (`bookings`) | Tableau · ProServ Scorecard Weekly Details (LATAM) | CSV drop |
| 2 | Revenue (`revenue`) | Tableau · same | CSV drop |
| 3 | Utilization (`utilization`) | Tableau · same | CSV drop |
| 4 | Projects in Red (`projectsRed`) | Tableau · same | CSV drop |
| 5 | Bench (`bench`) | Tableau · same | CSV drop |
| 6 | Headcount (`headcount`) | Tableau · same | CSV drop |
| 7 | GDC Usage (`gdcUsage`) | Tableau · same | CSV drop |
| 8 | T&M Bill Rate (`tmBillRate`) | Tableau · same | CSV drop |
| 9 | Delivery Margin (`deliveryMargin`) | Tableau · same | CSV drop |
| 10 | Pipe Gen (`pipeGen`) | Tableau · same | CSV drop |
| 11 | ARI (`ari`) | Apps Script `/exec` | `lib/sources/ari.js` (push) |
| 12 | Coworker Activation (`activation`) | coworker-activation-owners-by-leader.html (ProServ) | `lib/sources/ownership.js` |

> **Confirm the guesses for the 6 new metrics** — I assumed units + directions:
> Bench = % (lower better), Headcount = count, GDC Usage = %, T&M Bill Rate = $,
> Delivery Margin = % , Pipe Gen = $. Adjust `unit`/`higherIsBetter` in
> `lib/kpi.js` (KPIS) and `target`/`yellowBand` in `config/cockpit.json`.

Run a preview any time (no Slack calls):
```bash
node scripts/publish-cockpit.js --dry-run
```
Publish/refresh the canvas now:
```bash
node scripts/publish-cockpit.js
```
Or via the web app: `GET /api/kpis` (preview) and `POST /api/kpis/publish`.

Secrets live in `.env` (gitignored). View mappings/targets live in
`config/cockpit.json` (gitignored). Neither is committed.

---

## 1–4 · Tableau — weekly CSV drop (`TABLEAU_MODE=csv`)

**Why not the API:** the ProServ Scorecard workbook
(`ProServScorecard-2_02`, view LUID `b21af8bb-ecbc-4922-abfa-9cbcb0e5b64e`,
filter field **`Location`**) publishes only the *dashboard*, and all its data
sources are **embedded**. Neither the view-data API nor VizQL Data Service can
read embedded-only workbooks. Verified via the Metadata API. So the reliable
path is a weekly CSV.

**Weekly workflow (~1 min):**
1. Open the view, set **`Location` = LATAM**:
   `https://prod-uswest-c.online.tableau.com/#/site/salesforce/views/ProServScorecard-2_02/ProServScorecardWeeklyDetails`
2. Read the numbers and put them in **`data/latam-kpis.csv`** (all 10 Tableau keys):
   ```csv
   key,value,asOf
   bookings,12500000,2026-09-22
   revenue,9100000,2026-09-22
   utilization,78,2026-09-22
   projectsRed,4,2026-09-22
   bench,12,2026-09-22
   headcount,214,2026-09-22
   gdcUsage,38,2026-09-22
   tmBillRate,215,2026-09-22
   deliveryMargin,33,2026-09-22
   pipeGen,18000000,2026-09-22
   ```
   - `value` is a plain number ($/%, commas are stripped automatically).
   - `asOf` (optional) is the data date shown on the cockpit.
3. Publish: `node scripts/publish-cockpit.js` (or the weekly cron does it).

Any `key` in this CSV overrides all other sources — so it's also a manual
escape hatch for ARI/activation if ever needed.

**If a published data source or tabbed views ever appear** (ask the workbook
owner), flip `TABLEAU_MODE=api`, fill `config/cockpit.json → tableau.kpis`
(`viewId` / `filters` / `extract`) or wire VDS — the plumbing is already built
(`lib/sources/tableau.js`, discovery via `scripts/tableau-dump.js`).

## 5 · ARI — PUSH from Apps Script (recommended)

The `/exec` returns an HTML **login wall** to the server (no SSO identity). The
robust fix is to have your Apps Script **post** the ARI value weekly to the
cockpit — this runs as *you*, so it sidesteps inbound-access policy.

**Server side (done):** `POST /api/kpis/ingest`, guarded by `INGEST_SECRET`
(already set in `.env`). Precedence: manual CSV > pushed > live adapter.

**Apps Script — add this function + a weekly trigger:**
```javascript
function pushAriToCockpit() {
  var ari = computeAri();               // <-- your existing ARI number
  UrlFetchApp.fetch('https://<YOUR-COCKPIT-URL>/api/kpis/ingest', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      key: 'ari',
      value: ari,
      asOf: Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd'),
      secret: 'HH6bmVx4rfdgny3JYRNmB5Sml5563Uk0'   // == INGEST_SECRET in .env
    })
  });
}
```
Then in the Apps Script editor: **Triggers → Add Trigger → `pushAriToCockpit`
→ Time-driven → Weekly** (schedule it a bit before the cockpit cron, e.g. Monday
07:00). Replace `<YOUR-COCKPIT-URL>` with your deployed host (`APP_URL`).

> Verify manually: run `pushAriToCockpit` once, then
> `curl https://<host>/api/kpis?...` or `node scripts/publish-cockpit.js --dry-run`
> — ARI should show `· pushed`.

**PULL alternative** (only if your org allows *Anyone* access on Apps Script):
add a JSON branch to `doGet` (skeleton in `lib/sources/ari.js` header), deploy
with access *Anyone* + secret, then set `ARI_URL`/`ARI_KEY` in `.env`.

## 6 · Coworker Activation — DONE ✅

Source: Slack file `coworker-activation-owners-by-leader.html` (`F0C53JKR5UY`).
Account rows are embedded as JSON in `<script id="play1Data">`; each row has
`act` (owner type, incl. "ProServ") and `activated` (boolean). The file is
already LATAM-scoped. **Metric = activated ProServ rows ÷ total ProServ rows.**
Current: 6 / 17 = **35%**.

Config (`config/cockpit.json → ownership`): `dataScriptId: play1Data`,
`ownerField: act`, `proServMatch: ["ProServ"]`, `activatedField: activated`,
`activatedTrue: [true, ...]`.

**Weekly refresh — pick one:**
- **Slack bot download (automated):** set `OWNERSHIP_SLACK_FILE_ID=F0C53JKR5UY`;
  the app pulls the latest file each run. Needs the Slack bot to have
  `files:read` **and** access to that file (it's a user upload — share it into a
  channel the bot is in, or re-upload there). Falls back to `OWNERSHIP_FILE` if
  the download fails.
- **Manual (current default):** the committed `data/coworker-activation.html`
  (gitignored) is parsed. Replace it weekly with the fresh export.
- **Push:** post the % to `/api/kpis/ingest` with `key: activation` (same
  mechanism as ARI).

---

## Slack canvas

1. In your Slack app (api.slack.com/apps) add scopes: **`canvases:write`,
   `canvases:read`** (you already have `chat:write`, `users:read`). Reinstall.
2. Set `COCKPIT_GM_SLACK_ID` (GM's `U…` id) to grant read + weekly DM ping, and
   optionally `COCKPIT_CHANNEL`.
3. Set `COCKPIT_ENABLED=true` to arm the weekly cron (`COCKPIT_CRON`, default
   Monday 08:00 `REMINDER_TZ`).

## Grading

Status dots come from `config/cockpit.json → targets[key]` = `{ target, yellowBand }`.
Higher-is-better KPIs go green at ≥ target; "Projects in Red" is lower-is-better.
No target ⇒ ⚪️ (value shown, not graded).
