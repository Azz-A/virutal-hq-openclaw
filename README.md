# OpenClaw Railway Template (1‑click deploy)

This repo packages **OpenClaw** for Railway with a small **/setup** web wizard so users can deploy and onboard **without running any commands**.

## What you get

- **OpenClaw Gateway + Control UI** (served at `/` and `/openclaw`)
- A friendly **Setup Wizard** at `/setup` (protected by a password)
- Persistent state via **Railway Volume** (so config/credentials/memory survive redeploys)
- One-click **Export backup** (so users can migrate off Railway later)
- **Import backup** from `/setup` (advanced recovery)

## How it works (high level)

- The container runs a wrapper web server.
- The wrapper protects `/setup` (and the Control UI at `/openclaw`) with `SETUP_PASSWORD` using HTTP Basic auth.
- During setup, the wrapper runs `openclaw onboard --non-interactive ...` inside the container, writes state to the volume, and then starts the gateway.
- After setup, **`/` is OpenClaw**. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.

## Railway deploy instructions (what you’ll publish as a Template)

In Railway Template Composer:

1) Create a new template from this GitHub repo.
2) Add a **Volume** mounted at `/data`.
3) Set the following variables:

Required:
- `SETUP_PASSWORD` — password for `/setup` and the Control UI (`/openclaw`) via HTTP Basic auth. Use at least 16 random characters: it guards a public URL. Without it, the wrapper refuses to serve `/setup`, the dashboard, and WebSockets.
- `PORT=8080` — the port the wrapper listens on. It must match the Railway domain's target port (step 4).

Recommended:
- `OPENCLAW_STATE_DIR=/data/.openclaw`
- `OPENCLAW_WORKSPACE_DIR=/data/workspace`

Strongly recommended:
- `OPENCLAW_GATEWAY_TOKEN` — the gateway admin secret. You paste it into the Control UI to connect. If not set, the wrapper generates one in `/data/.openclaw/gateway.token`. In a template, set it using a generated secret.

Optional:
- `OPENCLAW_PUBLIC_ORIGIN` — the public HTTPS origin browsers use (for example a custom domain). Defaults to `https://$RAILWAY_PUBLIC_DOMAIN`. Browser WebSocket upgrades from any other origin are rejected.
- `OPENCLAW_ALLOW_STATE_MIGRATION=1` — only for a deploy that intentionally migrates an existing volume to a different OpenClaw version; enables the **maintenance.migrate** console command. See [Upgrading OpenClaw](#upgrading-openclaw).
- `OPENCLAW_SETUP_CHANNELS=1` — lets `/setup` configure Telegram, Discord, and Slack. Off by default.
- `OPENCLAW_MIGRATION_TIMEOUT_MS` (default 30 minutes), `GATEWAY_READY_TIMEOUT_MS` (default 120 s).

Notes:
- This template runs the official OpenClaw image, pinned by version and digest via Docker build arg `OPENCLAW_IMAGE`. See [Upgrading OpenClaw](#upgrading-openclaw) before changing it.

4) Enable **Public Networking** (HTTP) and generate a domain with **target port `8080`**.
5) Deploy.

Then:
- Visit `https://<your-app>.up.railway.app/setup`
  - Your browser will prompt for **HTTP Basic auth**. Use any username; the password is `SETUP_PASSWORD`.
- Complete setup
- Visit `https://<your-app>.up.railway.app/` and `/openclaw` (same Basic auth), then connect the Control UI with `OPENCLAW_GATEWAY_TOKEN`

## Support / community

- GitHub Issues: https://github.com/vignesh07/clawdbot-railway-template/issues
- Discord: https://discord.com/invite/clawd

If you’re filing a bug, please include the output of:
- `/healthz`
- `/setup/api/debug` (after authenticating to /setup)

## Getting chat tokens (so you don’t have to scramble)

### Telegram bot token
1) Open Telegram and message **@BotFather**
2) Run `/newbot` and follow the prompts
3) BotFather will give you a token that looks like: `123456789:AA...`
4) Paste that token into `/setup`

### Discord bot token
1) Go to the Discord Developer Portal: https://discord.com/developers/applications
2) **New Application** → pick a name
3) Open the **Bot** tab → **Add Bot**
4) Copy the **Bot Token** and paste it into `/setup`
5) Invite the bot to your server (OAuth2 URL Generator → scopes: `bot`, `applications.commands`; then choose permissions)

## Persistence (Railway volume)

Railway containers have an ephemeral filesystem. Only the mounted volume at `/data` persists across restarts/redeploys.

What persists cleanly today:
- **Custom skills / code:** anything under `OPENCLAW_WORKSPACE_DIR` (default: `/data/workspace`)
- **Node global tools (npm/pnpm):** this template configures defaults so global installs land under `/data`:
  - npm globals: `/data/npm` (binaries in `/data/npm/bin`)
  - pnpm globals: `/data/pnpm` (binaries) + `/data/pnpm-store` (store)
- **Python packages:** create a venv under `/data` (example below). The runtime image includes Python + venv support.

What does *not* persist cleanly:
- `apt-get install ...` (installs into `/usr/*`)
- Homebrew installs (typically `/opt/homebrew` or similar)

### Optional bootstrap hook

If `/data/workspace/bootstrap.sh` exists, the wrapper will run it on startup (best-effort) before starting the gateway.
Use this to initialize persistent install prefixes or create a venv.

Example `bootstrap.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Example: create a persistent python venv
python3 -m venv /data/venv || true

# Example: ensure npm/pnpm dirs exist
mkdir -p /data/npm /data/npm-cache /data/pnpm /data/pnpm-store
```

## Troubleshooting

### “disconnected (1008): pairing required” / dashboard health offline

This is not a crash — it means the gateway is running, but no device has been approved yet.

Fix:
- Open `/setup`
- Use the **Debug Console**:
  - `openclaw devices list`
  - `openclaw devices approve <requestId>`

If `openclaw devices list` shows no pending request IDs:
- Make sure you’re visiting the Control UI at `/openclaw` (or your native app) and letting it attempt to connect
  - The wrapper does not inject the gateway token; paste `OPENCLAW_GATEWAY_TOKEN` into the Control UI when it asks for the gateway secret.
- Ensure your state dir is the Railway volume (recommended): `OPENCLAW_STATE_DIR=/data/.openclaw`
- Check `/setup/api/debug` for the active state/workspace dirs + gateway readiness

### “unauthorized: gateway token mismatch”

The Control UI connects using `gateway.remote.token` and the gateway validates `gateway.auth.token`.

Fix:
- Re-run `/setup` so the wrapper writes both tokens.
- Or set both values to the same token in config.

### “Application failed to respond” / 502 Bad Gateway

Most often this means the wrapper is up, but the gateway can’t start or can’t bind.

Checklist:
- Ensure you mounted a **Volume** at `/data` and set:
  - `OPENCLAW_STATE_DIR=/data/.openclaw`
  - `OPENCLAW_WORKSPACE_DIR=/data/workspace`
- Ensure **Public Networking** is enabled (Railway will inject `PORT`).
- Check Railway logs for the wrapper error: it will show `Gateway not ready:` with the reason.

### Legacy CLAWDBOT_* env vars / multiple state directories

If you see warnings about deprecated `CLAWDBOT_*` variables or state dir split-brain (e.g. `~/.openclaw` vs `/data/...`):
- Use `OPENCLAW_*` variables only
- Ensure `OPENCLAW_STATE_DIR=/data/.openclaw` and `OPENCLAW_WORKSPACE_DIR=/data/workspace`
- Redeploy after fixing Railway Variables

### Gateway won't start: `state was last written by OpenClaw X but Y is installed`

The volume belongs to a different OpenClaw version. The wrapper did not run Doctor and wrote nothing to `/data` (details in `/setup/api/debug` under `wrapper.startupCheck`). If you meant to migrate it, follow [Upgrading OpenClaw](#upgrading-openclaw) or [Migrating legacy OpenClaw data](#migrating-legacy-openclaw-data); otherwise you attached the wrong volume.

### State migration failed or timed out (`maintenance.status`)

`maintenance.migrate` runs `openclaw doctor --fix --non-interactive` with the gateway stopped, for at most `OPENCLAW_MIGRATION_TIMEOUT_MS` (default 30 minutes; Doctor then gets SIGTERM and 60 s to drain before SIGKILL). The output is in **maintenance.status** and `/setup/api/debug` under `wrapper.migration`. After a timeout the state may be partially migrated: inspect it from the Railway shell (`openclaw update status`) or restore the `/setup/export` backup before retrying.

## How startup treats `/data`

The wrapper never runs `doctor --fix` on startup. Every startup command has a timeout, and the gateway has `GATEWAY_READY_TIMEOUT_MS` (default 120 s) to become ready.

- **Empty volume:** nothing runs until you complete `/setup`. Onboarding writes a config owned by the installed OpenClaw version.
- **Volume written by the installed version:** the wrapper syncs the gateway token and public origin into the config, then starts the gateway.
- **Volume written by an older version, or of unknown version:** the gateway does not start and nothing is written to the volume. Migrating it is an explicit maintenance step (below).
- **Volume written by a newer version:** always refused.

Channel integrations (Telegram, Discord, Slack) are not configured by `/setup` unless the service sets `OPENCLAW_SETUP_CHANNELS=1`. In 2026.10.x, Discord and Slack are external plugins that OpenClaw installs and converges on first use, which can take many minutes.

## Fresh install (recommended when the old install holds nothing worth keeping)

A brand-new Railway service with its own empty volume avoids migrating legacy state entirely. Use it when the existing deployment was never configured (its `/setup` page says it is not configured and no AI provider or agents were set up).

**First confirm the old volume holds nothing valuable.** On the existing service, without changing anything:
1. Open `https://<old-domain>/healthz` and check `wrapper.configured` is `false`.
2. Open `/setup` and check the status says it is not configured.
3. Download `/setup/export` and list it (`tar -tzf openclaw-backup-*.tar.gz`). It should contain little beyond an empty `.openclaw/` (maybe `gateway.token`, `credentials/`) and an empty `workspace/`. Keep the archive.

If the archive contains `openclaw.json`, `agents/`, sessions, credentials files, or workspace files you care about, stop and use [Migrating legacy OpenClaw data](#migrating-legacy-openclaw-data) instead. Leave the old service and its volume untouched until the new one is verified; it is your rollback.

## Staging deployment (validate before production)

1. Push this branch and open a pull request (do not merge). The `Docker build` check builds the image in CI.
2. In Railway, create a **new service** in a staging environment from this branch. Never attach an existing volume.
3. Add a **new volume** mounted at `/data`.
4. Set **new** variables. Do not copy production values:
   - `SETUP_PASSWORD`: a fresh random value, for example `openssl rand -base64 24`.
   - `OPENCLAW_GATEWAY_TOKEN`: a fresh random value, for example `openssl rand -hex 32`.
   - `PORT=8080`, `OPENCLAW_STATE_DIR=/data/.openclaw`, `OPENCLAW_WORKSPACE_DIR=/data/workspace`.
   - Do not set `OPENCLAW_ALLOW_STATE_MIGRATION` or `OPENCLAW_SETUP_CHANNELS`, and do not add a real AI provider key yet.
5. Networking: generate a Railway domain with target port **8080**.
6. Deploy, then verify:
   - The build log shows `FROM ghcr.io/openclaw/openclaw:2026.10.3@sha256:70b8dbd2…` and the deploy healthcheck `/setup/healthz` passes.
   - `/healthz` returns `{"ok":true,"wrapper":{"configured":false},...}` with no paths or errors.
   - `/setup` asks for Basic auth; 10 wrong passwords from one IP return `429`.
   - Run setup with no provider and leave every channel field empty. `/setup/api/debug` shows `openclaw.version` `2026.10.3`, `wrapper.startupCheck.ok: true` with empty `failedSettings`, `wrapper.publicOrigin` equal to your staging domain, and `wrapper.request.clientAddress` equal to **your own public IP** (this confirms Railway's `X-Forwarded-For` handling).
   - Config editor: `channels` is absent (no Telegram, Discord, or Slack).
   - Open `/openclaw`, paste `OPENCLAW_GATEWAY_TOKEN`: the Control UI must report that pairing is required. Approve the device in `/setup` → **Pairing helper**, reconnect, and confirm it works.
   - Debug Console → `openclaw security audit --json` reports no critical or warning findings.

## Upgrading OpenClaw

Doctor migrations are one-way: older releases cannot open state that a newer release has upgraded. After an image bump, the gateway on an existing volume stays stopped until you migrate explicitly:

1. Back up (`/setup/export`) and rehearse on a staging service restored from that backup.
2. Deploy the new image with `OPENCLAW_ALLOW_STATE_MIGRATION=1`.
3. In `/setup` → Debug Console, run **maintenance.migrate**, then poll **maintenance.status** until it reports `SUCCEEDED`; the gateway starts by itself.
4. Delete `OPENCLAW_ALLOW_STATE_MIGRATION` and redeploy; the gateway must still start.

See the upstream guides: [Updating](https://docs.openclaw.ai/install/updating) and [Upgrading container images](https://docs.openclaw.ai/install/docker#upgrading-container-images).

## Migrating legacy OpenClaw data

Only needed to keep data from a deployment that last ran a release older than 2026.7 (for example 2026.3.x). Current releases refuse such state; it must pass through the **2026.9.5 bridge** first.

1. **Back up.** Download `/setup/export` from the running service and keep it somewhere safe.
2. **Stage on the bridge.** Create a separate Railway service with its own new volume from this branch, and *before the first deploy* set these Railway variables:
   `OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.9.5@sha256:ea298b62be8955d3ef750e2004a610dd90c3a30e5f9886e5d654d78a0c573218` (used as a Docker build arg) and `OPENCLAW_ALLOW_STATE_MIGRATION=1`.
   Then import the backup through `/setup` → **Import backup**. The gateway stays stopped (the startup check refuses the old state); run **maintenance.migrate** in the Debug Console and poll **maintenance.status**.
   The backup contains production's channel bot tokens, so the staging gateway connects to the same Telegram/Discord bots as soon as the migration succeeds and the gateway starts. Rehearse while production is stopped.
   Confirm the migration `SUCCEEDED`, `wrapper.startupCheck.ok` is `true` in `/setup/api/debug`, and channels, sessions, and memory look right. If Doctor reports a retired memory index, repeat with `2026.9.7`.
3. **Target.** Delete the `OPENCLAW_IMAGE` variable so the Dockerfile default (currently `2026.10.3`) applies, keep `OPENCLAW_ALLOW_STATE_MIGRATION=1`, redeploy staging, run **maintenance.migrate** again, and verify again, including a Control UI connection with `OPENCLAW_GATEWAY_TOKEN`. Then delete `OPENCLAW_ALLOW_STATE_MIGRATION` and redeploy; the gateway must still start.
4. **Production.** Only after staging passes: take a fresh backup and repeat steps 2–3 on the production service. Keep the backups until you are confident; they are the only rollback path.

## Local smoke test

```bash
docker build -t clawdbot-railway-template .

docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  clawdbot-railway-template

# open http://localhost:8080/setup (password: test)
```

---

## Official template / endorsements

- Officially recommended by OpenClaw: <https://docs.openclaw.ai/railway>
- Railway announcement (official): [Railway tweet announcing 1‑click OpenClaw deploy](https://x.com/railway/status/2015534958925013438)

  ![Railway official tweet screenshot](assets/railway-official-tweet.jpg)

- Endorsement from Railway CEO: [Jake Cooper tweet endorsing the OpenClaw Railway template](https://x.com/justjake/status/2015536083514405182)

  ![Jake Cooper endorsement tweet screenshot](assets/railway-ceo-endorsement.jpg)

- Created and maintained by **Vignesh N (@vignesh07)**
- **11000+ deploys on Railway and counting** [Link to template on Railway](https://railway.com/deploy/clawdbot-railway-template)

![Railway template deploy count](assets/railway-deploys.jpg)
