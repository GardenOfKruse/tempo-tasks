# Tempo · Scheduled Task Cards for Windows

> A lightweight, beautifully crafted Windows desktop app for scheduling commands as cards — each card is a command plus its schedule, runs on time, and reports results honestly.

[中文](README.md) · Built with Electron 33 + TypeScript + React 18

![Tempo home](docs/shots/02-home-light.png)

## Features

- **Card-based task management** — each card is a command (CMD / PowerShell / Python) with status, schedule, and last result at a glance
- **Flexible schedules** — run once, every interval (5 seconds to 365 days), daily, weekly, or 5-field cron with live preview of the next 3 runs
- **Trustworthy execution info** — run state, next-run countdown, per-day stats (runs / success rate / avg duration), history with filters, exit codes, stdout/stderr, duration
- **Reliable scheduling** — fires on time; missed schedules (app closed / system asleep) are caught up on next launch or wake-up, per task
- **Code-grade editor** — line numbers, Tab indent, horizontal scroll, find & replace, Ctrl+S, dirty-close protection
- **Bash-paste friendly** — multi-line Linux-style commands are automatically converted to a CMD-compatible single line before running
- **Data safety** — atomic JSON writes, daily snapshot rotation (7 days kept), task import/export, uninstall asks before deleting data
- **Optional tray** — default off; when enabled, closing hides to tray and scheduling continues. No background services, no auto-start unless you enable it
- **iOS-style visuals** — light/dark themes, continuous corners, restrained shadows, crisp motion

## Quick start

### Option 1: Download the installer (recommended)

Grab the latest from [Releases](https://github.com/GardenOfKruse/tempo-tasks/releases/latest):

- **`Tempo-Setup-x.y.z.exe`** — guided installer (per-user, no admin required, pick your install folder)
- `Tempo-Portable-x.y.z.exe` — single-file, no install needed
- `Tempo-x.y.z-win.zip` — unzip and run

> Installers are not code-signed; SmartScreen may ask you to click "More info → Run anyway" on first launch.

### Option 2: Run from source

```bash
npm install
npm run dev        # build and launch
```

Requires Node.js ≥ 20, Windows 10/11.

## Usage

1. Click **New task**, enter a name and command, pick a runner (CMD / PowerShell / Python) and a schedule
2. The card appears in the grid and fires on schedule; hover a card and click ▶ to run immediately
3. Click a card for details: history, live output, exit codes, duration; pause or edit any time

### Schedule semantics

| Type | Meaning |
|---|---|
| Once | fires at the exact time; if missed while the app was closed, it's flagged as missed (no catch-up) |
| Interval | every N seconds/minutes/hours/days since the last due time (no drift) |
| Daily / Weekly | local time |
| Cron | 5-field, local timezone, standard vixie semantics (dom/dow union) |

**Catch-up** (per task, on by default): a recurring task that missed its schedule while the app was closed runs once on next launch or system wake. Tempo only schedules while running — it doesn't pretend to be a background service.

## Data & privacy

- Everything is stored locally in `%APPDATA%\tempo-tasks` (single JSON + daily snapshots + `.bak`)
- Per-task history capped at 50 runs, output tails capped at 32 KB per stream
- Optional per-task run logs written to `runs/<taskId>/`
- No telemetry, no network calls

## Development

```bash
npm test         # domain unit tests (cron, schedules, validation, recovery…)
npm run e2e      # end-to-end tests (playwright driving a real hidden Electron window)
npm run build    # typecheck + bundle
npm run dist     # package: NSIS installer / portable / zip
```

Layout: `electron/` main process (scheduler, executor, storage, schedule models), `src/` renderer (React), `tests/` unit + E2E, `scripts/` build & measurement tooling.

## License

[MIT](LICENSE) · © [GardenOfKruse](https://github.com/GardenOfKruse)
