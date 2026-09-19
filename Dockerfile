# Single-container deployment: the app + its cron schedule both live here, so
# `docker compose up -d` alone fully activates scheduling — no host crontab
# needed. See AGENTS.md and cron/crontab.txt for what runs when.
FROM node:22-bookworm-slim

# cron drives the schedule; curl is used by bin/cron-run.sh for healthchecks.io
# pings (ca-certificates alongside it — curl needs the system CA bundle for
# TLS, unlike Node's HTTPS calls elsewhere in the app, which bundle their own
# and worked fine without this); sqlite3 is the CLI used by
# scripts/backup-db.sh (kept for parity even though off-box backups aren't
# wired up yet — see docs/BACKUPS.md); unzip is shelled out to by
# scripts/fetch-gtfs.js to read COTA's GTFS zip (present on macOS by default,
# so this was invisible until building for Linux); fontconfig + fonts-inter
# (the family every SVG label in src/map/*.js asks for, falling back to
# generic sans-serif) are needed because sharp's SVG compositing renders text
# via the system font stack — with none installed, every label (legends,
# bus-position numbers, callout text) silently drew blank instead of erroring,
# which is why it looked fine in logs but wrong in the actual post images.
# dos2unix converts Windows line endings to Unix (critical when the repo is
# checked out with autocrlf or git line-ending filters on Windows).
RUN apt-get update && apt-get install -y --no-install-recommends \
    cron curl ca-certificates sqlite3 unzip fontconfig fonts-inter fonts-dejavu-core dos2unix \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# package.json's "prepare" script installs husky's git hooks via the husky
# CLI, which isn't present here (devDependency, omitted in a prod install,
# and there's no .git in the image anyway) — drop just that script so `npm ci`
# doesn't fail on it. Other packages' own install/postinstall scripts (e.g.
# better-sqlite3's prebuilt-binary fetch) are untouched.
RUN npm pkg delete scripts.prepare && npm ci --omit=dev

COPY . .

# Convert Windows line endings to Unix in shell scripts and cron config before
# they're used by crontab or bash. This is critical when the repo is checked
# out with autocrlf or git line-ending filters on Windows.
RUN find /app/bin -name '*.sh' -exec dos2unix {} + && \
    dos2unix /app/cron/crontab.txt

# state/ and data/ are gitignored (runtime DB + GTFS cache) — create them so
# the bind-mounted volumes in docker-compose.yml have somewhere to land even
# before the first run populates them.
RUN mkdir -p /app/state /app/data/gtfs /app/data/patterns

# Bake the cron schedule into root's crontab, substituting the placeholder
# repo path for this image's checkout — mirrors what scripts/install-crontab.sh
# does for a host crontab, just targeting the image instead. Use sh -c to
# explicitly set line endings on the installed crontab.
RUN sed 's#/path/to/metro-insights#/app#g' cron/crontab.txt | sh -c 'dos2unix && crontab -'

CMD ["cron", "-f"]
