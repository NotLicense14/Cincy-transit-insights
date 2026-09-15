# Cincy-Metro-insights

This is a single-agency fork of the original [cta-insights project](https://github.com/cailinpitt/chicago-transit-insights.git) by Cailin Pitt and is loosely based off of the [cota-insights bot](https://github.com/trevinflick/transit-insights.git) by Trevin Flickinger. 

Cincinnati has real-time GTFS data for Go-Metro buses and the streetcar. This is a Bluesky bot that turns that tracker data into Cincinnati-specific transit visualizations.

- **BSKY Account**: [@go-metro-insights.bsky.social](https://bsky.app/profile/go-metro-insights.bsky.social)

This README is written for operators running their own copy. If you just want to see the output, follow the accounts above. Scroll to the [Examples gallery](#examples-gallery) for sample posts.

## What it posts

> Each major feature has a deep-dive in [`docs/`](docs/): [bunching](docs/BUNCHING.md), [gaps](docs/GAPS.md), [ghosting](docs/GHOSTING.md), [speedmaps](docs/SPEEDMAP.md). (Those docs were written for the original CTA fork — the detection logic they describe is unchanged, but a few train-only passages no longer apply here.)
- **Bunching** — clusters of buses on the same route/direction, as an annotated map. Reply includes a ~10-minute timelapse video of the cluster, with traffic signals and bus stops annotated.
- **Gaps** — long stretches with no bus service, compared against the scheduled headway from GTFS.
- **Speedmap** — a bus route color-coded by observed speed over a 1-hour window.
- **Heatmap** — weekly/monthly rollup of chronic bunching and gap stops across Cincinnati.
- **Ghost buses** — hourly rollup of routes with materially fewer active buses than the schedule implies.

The bus bot tracks a subset of Go-METRO routes — see `src/bus/routes.js`.

## Setup

1. **Clone and install**
   ```
   git clone https://github.com/NotLicense14/Cincy-transit-insights.git
   cd cincy-transit-insights
   npm install
   ```

2. **Install `ffmpeg`** — required for bunching timelapse replies.
   ```
   brew install ffmpeg    # macOS
   apt install ffmpeg     # Debian/Ubuntu
   ```

3. **Create `.env`** — `cp .env.example .env` and fill in:

   | Var | What it's for | Where to get it |
   |---|---|---|
   | `MAPBOX_TOKEN` | Mapbox Static Images API | [account.mapbox.com](https://account.mapbox.com/access-tokens/) |
   | `BLUESKY_SERVICE` | Bluesky PDS URL | defaults to `https://bsky.social` |
   | `BLUESKY_BUS_IDENTIFIER` | Bus bot handle or DID | your Bluesky account |
   | `BLUESKY_BUS_APP_PASSWORD` | Bus bot app password | bsky.app → Settings → Privacy and Security → App Passwords |
   No API key is necessary to access Go-Metro GTFS data.

4. **Build the GTFS index** — required before any gap or ghost detection runs.
   ```
   npm run fetch-gtfs
   ```

5. **Fetch traffic signals** — optional, one-time. Annotates bus bunching timelapse videos with intersection signals.
   ```
   npm run fetch-signals
   ```

6. **Smoke test** — loads every bin file with `--check`.
   ```
   # Windows
   npm run smokeWindows

   # Linux/macOS
   npm run smokeLinux
   ```

7. **Try a dry run** — writes an image under `assets/`, does not post.
   ```
   npm run bunching:dry
   ```

## Running it

Everything is designed to be driven by cron. There's no long-running process — each script does one detection or rollup and exits. The full schedule lives in [`cron/crontab.txt`](cron/crontab.txt). On a fresh server with no other cron jobs you can install it with `crontab cron/crontab.txt`. **On any server that already has unrelated cron jobs**, DO NOT use that destructive form — it replaces every job for the user. Instead, merge between the `# METRO-INSIGHTS-START` / `# METRO-INSIGHTS-END` markers (or just run scripts/install-crontab.sh, which does this safely); the crontab file's header has a step-by-step procedure too.

Each line uses [`bin/cron-run.sh`](bin/cron-run.sh) — a small wrapper that handles `cd` to the repo root, timestamps each invocation, and redirects stdout/stderr to `cron/<log-name>-cron.log`. So a job entry is just:

```cron
1-59/20 * * * * /home/you/metro-insights/bin/cron-run.sh bus-bunching bin/bus/bunching.js
```

instead of repeating the boilerplate on every line. The snapshot timelapse runs in-process for ~15 minutes per invocation, so it's scheduled every 3 hours; everything else is fast and runs on its own cadence.

### Log rotation

Each cron job appends to `cron/<name>-cron.log`, so the log files grow without bound by default. [`cron/logrotate.conf`](cron/logrotate.conf) is a template policy (daily, 10MB size cap, 14 compressed rotations, `copytruncate` to preserve the inode `cron-run.sh` writes to). Install it once on the server with:

```
sudo scripts/install-logrotate.sh
```

The installer detects the owner of the local `cron/` directory and substitutes `CRON_LOG_DIR` / `SU_USER` / `SU_GROUP` placeholders before writing to `/etc/logrotate.d/go-metro-insights`, then validates the result with `logrotate -d`. The system's daily logrotate timer picks it up overnight; the `su` directive is required because the cron log directory isn't root-owned.

### Monitoring

Liveness is delegated to [healthchecks.io](https://healthchecks.io). `cron-run.sh` (and `push-web-data.sh`, via its EXIT trap) pings `https://hc-ping.com/<ping-key>/<slug>/start` before a job runs and `.../<slug>/<exit-code>?create=1` after, where `<slug>` is the job's log-name. The exit code lets healthchecks alert on both silence (the box/network/METRO feed died) and a job that ran but crashed, and the start/finish pair lets it measure each job's run **duration**. The `?create=1` ([auto-provisioning](https://healthchecks.io/docs/autoprovisioning/)) means the first ping for a slug creates its check automatically — no pre-registration. Its dashboard is the at-a-glance "what ran recently / how long it took / what's overdue" view, and notification routing (email, ntfy, …) is configured in its UI — nothing to self-host.

Only a curated subset pings, via the `HC_MONITORED` allowlist in [`bin/cron-run.sh`](bin/cron-run.sh): the full roster is 23 jobs but the free tier caps at 20 checks, so the committed allowlist watches the ~18 that matter (canaries, posting bots, real-time detectors, GTFS freshness) and skips the low-stakes ones (recaps, snapshot, `fetch-signals`, `incident-roundup`). Widen/narrow by editing that list. Pinging is a no-op unless `cron/healthchecks.env` exists on the server; copy [`cron/healthchecks.env.example`](cron/healthchecks.env.example) and follow its setup notes (paste the project ping key; tune each auto-created check's period + grace, since they default to a loose 1d/1h).

## Scripts reference

All bin scripts accept `--dry-run` (writes image under `assets/` instead of posting). Recap scripts additionally accept `--window week|month` (default `month`).

### Posting
| Command | Description |
|---|---|
| `npm run bunching` / `:dry` | Bus bunching detection |
| `npm run gaps` / `:dry` | Bus gap detection |
| `npm run speedmap` / `:dry` | Bus speedmap collection (1-hour window) |
| `npm run recap` / `:dry` | Bus recap — bunching heatmap + threaded gap-leaderboard reply |
| `npm run ghosts` / `:dry` | Bus ghost rollup (hourly) |
| `node bin/bus/cross-bunching.js --dry-run` | Cross-route bunching (2+ routes piled up at one corner) |
| `node bin/bus/thin-gaps.js --dry-run` | Gap detection for low-frequency routes |

### Observers / maintenance
| Command | Description |
|---|---|
| `npm run observe-buses` | Bus observer — fetches every active Metro route and records positions (no posting). Run every minute. |
| `npm run fetch-gtfs` | Rebuild `data/gtfs/index.json`. Run daily. |
| `npm run fetch-signals` | Rebuild `data/signals/signals.json` from OpenStreetMap. Run monthly. |

### Dev
| Command | Description |
|---|---|
| `npm test` | Run the test suite (`node --test`). |
| `npm run smokeWindows` / `npm run smokeLinux` | Load each bus bin with `--check` — fast sanity check after edits. |
| `npm run format` | Format all JS/JSON with [Biome](https://biomejs.dev/). |
| `npm run lint` | Report Biome lint warnings (no changes written). |
| `npm run check` | Format + apply safe lint fixes across the whole repo. |

Formatting + safe lint fixes run automatically on `git commit` via a husky pre-commit hook (`.husky/pre-commit` → `lint-staged` → `biome check --write` on staged `*.{js,json}` files only). Config lives in `biome.json`. After cloning, `npm install` runs `prepare` which installs the hook for you.

## How it works

Each major feature has a deep-dive doc in [`docs/`](docs/):
- [BUNCHING.md](docs/BUNCHING.md) — cluster detection,
- [GAPS.md](docs/GAPS.md) — long-gap detection vs. scheduled headway,
- [GHOSTING.md](docs/GHOSTING.md) — hourly missing-vehicle detection,
- [SPEEDMAP.md](docs/SPEEDMAP.md) — colored route speed maps.

### Data sources
- **Go-Metro GTFS-realtime** — live vehicle positions, polled by each script for its detection window.
- **GTFS static feed** — the scheduled baseline for gap and ghost detection. Rebuilt daily from the Metro's published bundle into `data/gtfs/index.json`. Headways/durations are keyed **per pattern** — `(route/line, direction) → patterns[]`, where each pattern is one origin→dest terminal pair with its own `(day_type, hour) → { median headway, median trip duration }`. Measuring within a single pattern keeps short-turns and branches from corrupting the median (mixing them per-direction read the 66 at ~6 min vs a true 30 overnight). A live vehicle's pattern is matched to a group by its endpoint coordinates.
- **OpenStreetMap (Overpass)** — traffic signal nodes inside a Cincinnati bounding box, used to annotate bus bunching timelapses. Rebuilt monthly.
- **Mapbox Static Images API** — base maps for every rendered image.

### Observation flow
Every call to `getVehicles` writes a row to the `observations` table in `history.sqlite`. That means *every* job — bunching, gaps, and speedmaps — contribute data that ghost detection later consumes.

Bus routes not touched by bunching or gaps need an explicit observer run to show up in the ghost rollups. `scripts/observeBuses.js` handles that, fetching every active METRO route every minute. Bunching, gaps, and pulse all read the resulting snapshot via `getVehiclesCachedOrFresh` (90s cache window) so the observer is the only API call site for the all-routes workload.

### History DB and callouts
`state/history.sqlite` records every detection (posted or cooldown-suppressed) and every observation. Retention is 90 days. Two things feed off it:
- **Cooldown** — posts for the same route/direction inside a short window are suppressed to avoid spam. Tracked in `state/posted.json`.
- **Callouts** — each post is annotated with frequency and severity from prior records, e.g. *"3rd Route 66 bunch reported today"* or *"largest gap reported on this line in 30 days"*.

SQLite runs in **WAL mode**. If you inspect `history.sqlite` with a CLI while jobs are running, recent rows may still live in `history.sqlite-wal` until checkpoint.

### Ghost detection math
```
expected_active = trip_duration / headway
missing = expected_active − observed_active
```
`observed_active` is the median distinct-vehicle count per polling snapshot over the past hour. A ghost event requires **both**:
- `missing / expected_active` ≥ 25%, **and**
- `missing` ≥ 3 vehicles in absolute terms.

The absolute floor keeps single-vehicle routes (where a 1-bus gap is 50% of expected) from producing hair-trigger posts.

### GTFS freshness gates
`loadIndex()` checks the age of `data/gtfs/index.json`:
- **> 2 days old** — warns on stderr.
- **> 7 days old** — throws.

Because the index honors `calendar_dates.txt`, a stale index misreports holiday/special-service days. The fatal threshold makes a missed cron loud rather than silently reporting against the wrong schedule.

## State and storage

Local state (gitignored, operator-managed):

| Path | Purpose | Rebuilt by |
|---|---|---|
| `state/posted.json` | Cooldown keys + timestamps | each posting job |
| `state/history.sqlite` | Detections + observations, 90-day window | each posting + observer job |
| `data/gtfs/index.json` | Schedule lookup | `npm run fetch-gtfs` (daily) |
| `data/signals/signals.json` | OSM traffic signals | `npm run fetch-signals` (monthly) |
| `data/patterns/*.json` | Cached bus route patterns (7-day TTL) | populated on demand |

## Examples gallery

The screenshots below are from the original Chicago/CTA deployment that this repo was forked from.

### Bus bunching
> 🚌 Route 66 (Chicago) — Eastbound
> 4 buses within 330 ft near Grand & Union
> 📊 3rd Route 66 bunch reported today

![Bus bunching example](docs/images/bus-bunching.jpg)

Reply: ~10-minute timelapse video of the cluster, with intersection traffic signals and bus stops annotated.

### Bus gap
> 🕳️ Route 76 (Diversey) — Westbound
> No bus near Diversey & Oak Park for ~20 min — scheduled around every 6 min this hour
>
> Last seen: #1934 · Next up: #8021

![Bus gap example](docs/images/bus-gap.jpg)

Reply: ~10-minute timelapse following the next bus closing in on the wait stop, with a live ETA readout (deep gaps stay a still). See [GAPS.md](docs/GAPS.md#timelapse-reply).

### Bus speedmap
> 🚦 Route 77 (Belmont) — Westbound
> 10:00 PM–11:00 PM CT · average speed 12.9 mph
>
> Each colored segment of the route shows how fast buses were moving there:
> 🟥 under 5 mph — stopped or crawling
> 🟧 5–10 mph — slow
> 🟨 10–15 mph — moderate
> 🟩 15+ mph — moving well

![Bus speedmap](docs/images/bus-speedmap.jpg)

### Bus recap
> 🚌 Chronic bus bunching spots, this week
>
> 97 bunches observed near 27 stops:
> · Grand & Union — Route 66 (9)
> · Michigan & Superior — Routes 147, 151 (5)
> · Washington & Canal — Routes 20, 56, 60 (5)
>
> Only what the bot observed; real totals are higher.

![Bus heatmap](docs/images/heatmap-bus.jpg)

Reply: a square bar chart of headway gaps by route over the same window.

### Bus ghost rollup
> 👻 Ghost buses, past hour
>
> 🚌 Route 146 (Inner Lake Shore/Michigan Exp.) SB · 4 of 12 missing (31%) · every ~7 min instead of ~5

![Bus ghost rollup](docs/images/ghost-bus.jpg)

## Contributing and issues

METRO-SORTA data © Southwest Ohio Regional Transit Authority. Base maps © Mapbox, © OpenStreetMap contributors.
