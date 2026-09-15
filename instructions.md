# Go-Metro Insights: Operator Instructions

This document describes how to install, configure, run, schedule, and maintain
the Cincinnati Go-Metro bus bot.

## What the bot does

Go-Metro Insights is a cron-driven Bluesky bot. Each command performs one
operation and exits; it is not a long-running daemon.

Supported features:

- **Bunching:** buses on the same route and direction are too close together.
- **Gaps:** unusually long stretches without service compared with GTFS.
- **Speedmaps:** observed bus speeds over a one-hour collection window.
- **Ghost buses:** routes with materially fewer active buses than scheduled.
- **Recaps:** weekly or monthly bunching and gap summaries.
- **Cross-route bunching:** multiple routes collected at one location.
- **Thin gaps:** gap detection for low-frequency routes.

The data source is Go-Metro/SORTA for Cincinnati and nearby Northern Kentucky.
Its realtime feeds are public and do not require a Metro API key.

## Prerequisites

Install:

- Node.js and npm (a current Node.js LTS release is recommended).
- `ffmpeg`, required for timelapse videos.
- A Mapbox access token for rendered maps.
- A Bluesky account and app password for the bot.
- Linux/macOS production hosts also need `cron`, `bash`, `curl`, and optionally
  SQLite tooling for database inspection.

The bot commands and tests run on Windows. The cron installer and cron wrapper
are intended for a Linux/macOS production server.

## Install

```sh
git clone https://github.com/NotLicense14/Cincy-transit-insights.git
cd Cincy-transit-insights
npm install
```

On Windows, use `cd Cincy-transit-insights` in PowerShell or Command Prompt.
`npm install` installs the Husky repository hook. Never commit `.env`, app
passwords, Mapbox tokens, or generated state.

## Configure `.env`

Copy the example:

```sh
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Set the following values:

| Variable | Required | Purpose |
|---|---:|---|
| `BLUESKY_SERVICE` | No | PDS URL; defaults to `https://bsky.social`. |
| `BLUESKY_BUS_IDENTIFIER` | For posting | Bot Bluesky handle or DID. |
| `BLUESKY_BUS_APP_PASSWORD` | For posting | Bluesky app password. |
| `MAPBOX_TOKEN` | For maps | Mapbox Static Images API token. |
| `HISTORY_DB_PATH` | No | Alternate SQLite path, useful for isolated runs. |
| `TEST_ACCOUNT_IDENTIFIER` | No | Separate account for manual post tests. |
| `TEST_ACCOUNT_PASSWORD` | No | App password for that test account. |

No Metro API key is needed.

## Build generated data

Build the schedule index before gap, ghost, or schedule-dependent commands:

```sh
npm run fetch-gtfs
```

This downloads the current static feed and creates
`data/gtfs/index.json` and `data/gtfs/schedule.sqlite`. These files are
date-sensitive and gitignored. Rebuild them daily; `loadIndex()` warns after
two days and fails after seven days.

Traffic signals are optional but improve bunching-video annotations:

```sh
npm run fetch-signals
```

This writes `data/signals/signals.json` from Cincinnati-area OpenStreetMap
Overpass data. Run monthly. The command exits nonzero if all mirrors fail.

## Validate and dry-run

Windows:

```powershell
npm run smokeWindows
npm test
```

Linux/macOS:

```sh
npm run smokeLinux
npm test
```

The smoke command checks every supported `bin/bus/*.js` file without running
the job. Dry runs do not publish:

```sh
npm run bunching:dry
npm run gaps:dry
npm run speedmap:dry
npm run ghosts:dry
npm run recap:dry
node bin/bus/cross-bunching.js --dry-run
node bin/bus/thin-gaps.js --dry-run
node bin/export-event-tracks.js --dry-run
```

Rendered dry-run assets are written under `assets/` when a feature produces an
image.

## Run individual jobs

```sh
npm run bunching
npm run gaps
npm run speedmap
npm run ghosts
npm run recap
node bin/bus/cross-bunching.js
node bin/bus/thin-gaps.js
```

Observation and maintenance:

```sh
npm run observe-buses
npm run fetch-gtfs
npm run fetch-signals
node bin/export-event-tracks.js --dry-run
```

`observe-buses` records vehicle positions and does not post. The production
schedule runs it every minute so ghost detection has complete observations.

## Install production cron

The source-of-truth schedule is [`cron/crontab.txt`](cron/crontab.txt). It
runs detections, the observer, recaps, generated-data refreshes, event-track
exports, and database backups.

Preview and install the marked block on Linux/macOS:

```sh
scripts/install-crontab.sh --dry-run
scripts/install-crontab.sh
```

The installer preserves unrelated user cron jobs. Remove only this bot's jobs:

```sh
scripts/install-crontab.sh --remove
```

Do not use `crontab cron/crontab.txt` on a host that already has other cron
jobs, because that replaces the entire user's crontab.

Jobs use [`bin/cron-run.sh`](bin/cron-run.sh), which changes to the repository
root and appends output to `cron/<job>-cron.log`.

Optional healthchecks.io monitoring is enabled by copying
`cron/healthchecks.env.example` to `cron/healthchecks.env`, adding the project
ping key, and tuning the generated checks in healthchecks.io.

## Logs, rotation, and backups

Install log rotation once on the production host:

```sh
sudo scripts/install-logrotate.sh
```

Logs rotate daily with a 10 MB cap and 14 compressed rotations.

The cron schedule runs `scripts/backup-db.sh` daily. Review its destination
before enabling production cron. Review `scripts/restore-db.sh` carefully
before restoring a database.

## State and troubleshooting

Ignored operator state includes:

- `state/history.sqlite`: detections and observations, retained for 90 days.
- `state/posted.json`: cooldown state.
- `data/gtfs/`: generated schedule data.
- `data/signals/`: generated signal data.
- `data/patterns/`: on-demand pattern cache.
- `assets/`: dry-run output.
- `cron/*.log`: cron output.

For a failed scheduled job:

1. Read the matching `cron/*-cron.log`.
2. Confirm `data/gtfs/index.json` is current.
3. Run `npm run fetch-gtfs` after a missed refresh or extended laptop sleep.
4. Confirm the public Go-Metro feed and network are reachable.
5. Confirm `.env` has the credentials required by the failing operation.
6. Check for an existing process running the same posting job.

Do not edit or delete database rows while jobs are active. SQLite may have
recent data in its `-wal` file until checkpointing.

## Update procedure

```sh
git pull --ff-only
npm install
npm test
npm run fetch-gtfs
```

Use `npm run smokeWindows` on Windows or `npm run smokeLinux` on Linux/macOS.
Do not auto-commit, push, or pull as part of a bot run.
