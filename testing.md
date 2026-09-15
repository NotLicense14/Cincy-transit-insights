# Go-Metro Insights: Testing Guide

This document records the supported validation commands and expected results
for the current Cincinnati bus-only repository.

## Automated test suite

Install dependencies first:

```sh
npm install
```

Run:

```sh
npm test
```

Expected result:

- Node exits with status `0`.
- All tests are marked `✔`.
- The summary reports `fail 0`, `cancelled 0`, and `skipped 0`.
- The current suite contains **86 tests**.
- The expected summary is `tests 86`, `pass 86`, `fail 0`.

The suite covers bus bunching, gap detection, ghost trailing-deficit behavior,
CSV export, Bluesky reply handling, event-track helpers, cooldown logic,
geographic clustering, observations, and video-track interpolation.

If tests report a missing dependency, run `npm install`. If a schedule-dependent
test reports that `data/gtfs/index.json` is missing or stale, run:

```sh
npm run fetch-gtfs
```

Do not ignore test failures or treat a nonzero exit as success.

## Windows smoke test

```powershell
npm run smokeWindows
```

Expected result:

- Each supported `bin\bus\*.js` file is passed to `node --check`.
- No syntax error is printed.
- The process exits with status `0`.

The checked files are `bunching.js`, `cross-bunching.js`, `gaps.js`,
`ghosts.js`, `recap.js`, `speedmap.js`, and `thin-gaps.js`.

## Linux/macOS smoke test

```sh
npm run smokeLinux
```

Expected result:

- Every `bin/bus/*.js` file is checked.
- No syntax error is printed.
- The process exits with status `0`.

This command uses shell globbing and is not the Windows command.

## Biome formatting and lint

Check changed files without writing:

```sh
npx biome check package.json scripts/fetch-gtfs.js test/ghosts.test.js
```

Expected result:

```text
Checked 3 files in ...
No fixes applied.
```

Repository-wide commands:

```sh
npm run lint
npm run format
npm run check
```

`lint` reports findings. `format` writes formatting changes. `check` writes
formatting and safe lint fixes. Review changes before committing.

## GTFS build verification

```sh
npm run fetch-gtfs
```

Expected result:

- The current Go-Metro static GTFS archive is downloaded or a recent cache is
  used.
- `data/gtfs/index.json` is written.
- `data/gtfs/schedule.sqlite` is rebuilt.
- The command exits with status `0`.
- The output reports indexed bus routes and generated file paths.

Exact route and trip counts vary by service calendar. A zero-trip result on an
ordinary service day should be investigated.

## Traffic-signal build verification

```sh
npm run fetch-signals
```

Expected result:

- An Overpass mirror returns data.
- `data/signals/signals.json` is written.
- At least 1,000 signals are returned.
- The command exits with status `0`.

Fewer than 1,000 signals is treated as suspicious and causes another mirror
to be tried. If every mirror fails, the command exits `1` and a valid existing
cache should not be replaced.

## Dry-run verification

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

Expected result:

- No Bluesky post is published.
- Feature output is printed.
- Image-producing commands may write under `assets/`.
- No qualifying realtime event is a valid result.
- A missing required GTFS index is an actionable setup failure.

## Cron verification

Preview the merged crontab:

```sh
scripts/install-crontab.sh --dry-run
```

Expected result:

- One `GO-METRO-INSIGHTS-START` / `END` block is present.
- Existing unrelated cron entries are preserved.
- The repository path replaces `/path/to/metro-insights`.
- No removed train, CTA, alert, pulse, web-publish, or audit jobs appear.

After installation:

```sh
crontab -l
```

Expected result: the same single marked block is present, and matching
`cron/*-cron.log` files receive output according to the schedule.

## Release checklist

- [ ] `npm install` completed successfully.
- [ ] `npm test` reports 86 passing tests and zero failures.
- [ ] The platform-appropriate smoke test exits `0`.
- [ ] Biome reports no issues in changed JS/JSON files.
- [ ] `data/gtfs/index.json` is current.
- [ ] Dry runs did not publish.
- [ ] Production cron contains only supported Go-Metro jobs.
- [ ] No credentials or generated state are staged.
