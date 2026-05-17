# AGENTS.md

## Project

iMessage TikTok — small Node/CommonJS project that serves a local web UI and records/automates it with Puppeteer.

## Source of truth

- GitHub is the source of truth.
- Work on feature branches only.
- Do not commit generated recordings/data, local browser profiles, secrets, or machine-specific paths.
- MacBook-local repo is on branch `feat-imessage` with uncommitted work; do not overwrite it from the VM without explicit approval.

## Runtime

- Node/npm project, CommonJS.
- Docker Compose exists but assumes Linux audio/X11/Pulse devices; it is not a generic Mac/VM runtime without adaptation.
- Mac-specific recorder entry: `npm run record:mac`.

## Commands

- Install: `npm install`
- Start local server in GitHub/VM master: `npm run start` (`live-server public --port=3000`)
- Start local server in current MacBook `feat-imessage` worktree: `npm run serve` (`serve public -l 53694`)
- Record: `npm run record`
- Record on Mac: `npm run record:mac`
- Docker config check: `docker compose config --quiet`

## Verification

- There is currently no real automated test suite; `npm test` is a placeholder and exits 1.
- For UI changes, start the app and inspect/record manually or with browser tooling.
- For recorder changes, run on the MacBook where browser/audio permissions exist.
- For Docker changes, run `docker compose config --quiet` first.

## Definition of Done

- Manual or scripted smoke path documented in the PR/task summary.
- No generated media/data committed unless explicitly requested.
- No machine-specific absolute paths added.
- If logic grows, add a real test script before letting agents make larger changes.
