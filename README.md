# LATAM ProServ Transformation Plan — Live Cockpit

An enhanced clone of the LATAM Transformation Plan dashboard (`latamplan-…herokuapp.com`).
Same login + editable activity plan + Excel backup, **plus** a live execution cockpit and a
**Slack weekly reminder** that DMs each activity owner their open to-dos every Monday morning,
ahead of the Wednesday governance meeting.

## What's new vs. the original
- **Executive KPI strip** — activities, % complete, avg progress, due-before-meeting, overdue, blocked, help-needed.
- **"This Week — To-Dos Before Wednesday"** owner board — exactly what each owner receives in Slack.
- **Slack Monday reminder** — per-owner DMs, preview + send-now, owner-mapping health, auto-schedule.
- **Meeting countdown** to the next Wednesday.
- **Urgency filter + sort**, overdue/blocked row highlighting, pillar progress bars.
- Everything from the original is preserved (inline-editable table, filters, weekly focus, XLSX backup).

## Run locally
```bash
npm install
cp .env.example .env            # edit APP_USERNAME/APP_PASSWORD/SESSION_SECRET
cp slack/owners.example.json slack/owners.json   # optional, for Slack
npm start                       # http://localhost:3000  (login with your .env creds)
```

## Slack setup
1. Create an app at https://api.slack.com/apps → **OAuth & Permissions** → Bot Token Scopes:
   `chat:write`, `im:write`, `users:read`, `users:read.email`.
2. Install to workspace, copy the **Bot User OAuth Token** (`xoxb-…`) into `SLACK_BOT_TOKEN`.
3. Map owners in `slack/owners.json` — either a `slackId` (`U…`, most reliable) or corporate `email`.
4. In the cockpit: **Preview messages** (no send) → **Send now**. Green/red dots show which owners are mapped.

### Weekly auto-send (Monday morning → before Wed meeting)
Two options:
- **Built-in cron** (runs inside the web dyno): set `REMINDER_ENABLED=true`. Schedule via
  `REMINDER_CRON` (default `0 8 * * 1` = Mon 08:00) and `REMINDER_TZ` (default `America/New_York`).
- **Heroku Scheduler add-on** (recommended, survives dyno restarts): add job
  `node scripts/send-reminders.js` at the desired time. Use `--dry-run` to preview in logs.

```bash
npm run reminders:preview   # print what would be sent, no Slack calls
npm run reminders:send      # send for real (needs SLACK_BOT_TOKEN)
```

## Deploy to Heroku
```bash
heroku create latam-cockpit
heroku config:set APP_USERNAME=… APP_PASSWORD=… SESSION_SECRET=… \
  SLACK_BOT_TOKEN=xoxb-… REMINDER_ENABLED=true REMINDER_TZ=America/New_York \
  APP_URL=https://latam-cockpit.herokuapp.com
git init && git add . && git commit -m "LATAM cockpit" && git push heroku main
# optional durable schedule:
heroku addons:create scheduler:standard && heroku addons:open scheduler
```
> Note: activity data lives in `data/actions.json` on the dyno's ephemeral filesystem (same model as
> the original). For durable multi-user persistence, move the store in `lib/store.js` to Heroku Postgres.

## API
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` / `/api/logout` | session auth |
| GET/POST | `/api/actions` | list / create |
| PUT/DELETE | `/api/actions/:id` | edit / delete |
| GET | `/api/backups/latest` | download XLSX |
| GET | `/api/reminders/config` | schedule + owner-mapping status |
| GET | `/api/reminders/preview` | dry-run Slack messages |
| POST | `/api/reminders/send` | send Slack DMs now |

## Layout
```
server.js              Express app: auth, CRUD, backups, Slack endpoints, weekly cron
lib/plan.js            domain model: pillars, meeting cadence, urgency, digest + message builder
lib/store.js           JSON persistence + XLSX backup
lib/slack.js           Slack Web API client, owner resolution, send logic
scripts/send-reminders.js   standalone runner for Heroku Scheduler
public/                cockpit UI (index.html, styles.css, app.js, login.html)
data/actions.json      activity data (seeded from the live plan)
slack/owners.json      owner → Slack id/email mapping (gitignored)
```
