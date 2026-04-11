# Cloudflare Deployment Runbook — Zero to Live (Free Tiers)

Goal: Take this monorepo from a freshly cloned state to a working POC with 10 patrollers on their phones, using only free-tier services.

**Services you'll create (all free):**

- **Cloudflare** — Workers (API) + Pages (admin portal) + DNS (optional). Free plan.
- **Neon** — serverless Postgres database. Free plan (0.5 GB, auto-suspends).
- **Expo** — React Native build/distribution. Free plan (Expo Go) + EAS hobby tier (30 builds/month).

**Nothing else. No credit card required to start.**

---

## 0 · One-time prerequisites on your laptop

```bash
# Install Node.js ≥ 20 (https://nodejs.org)
node --version          # should print v20.x or higher

# Install pnpm globally
npm install -g pnpm
pnpm --version          # should print 9.x

# Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# Install EAS CLI (for Android APKs later)
npm install -g eas-cli
```

From the project root:

```bash
pnpm install            # installs every workspace
```

---

## 1 · Create the Neon database (3 minutes)

1. Go to **https://neon.tech** and click **Sign up**. GitHub login is easiest.
2. On the dashboard, click **New Project**.
   - Name: `patrol-log`
   - Postgres version: latest (default is fine)
   - Region: pick **aws-us-east-1** unless you want something geographically specific. Neon does not charge for data egress.
   - Database name: `patrol_log`
3. On the "Connection details" panel, copy the **pooled connection string**. It looks like:
   ```
   postgresql://neondb_owner:xxxxxxxx@ep-shiny-sun-abc123-pooler.us-east-1.aws.neon.tech/patrol_log?sslmode=require
   ```
   Keep this tab open — you'll paste this string a few times.

> Why Neon instead of Cloudflare D1 for the POC: D1 has a 10 GB per-database ceiling and single-writer constraint. Neon is real Postgres, scales horizontally, and has a serverless HTTP driver that runs natively in Cloudflare Workers. Both are free; Neon scales further.

---

## 2 · Push the schema and seed demo data (2 minutes)

Set `DATABASE_URL` in your current shell (this is separate from `apps/api/.dev.vars`, which the Worker reads at runtime — the `db:push` and `db:seed` scripts run from Node and read `process.env`).

```bash
# macOS/Linux
export DATABASE_URL="postgresql://neondb_owner:<password>@ep-<your-endpoint>.us-east-1.aws.neon.tech/neondb?sslmode=require"

# Windows PowerShell
$env:DATABASE_URL = "postgresql://neondb_owner:<password>@ep-<your-endpoint>.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

Then from the project root:

```bash
# Create all the tables and enums (drizzle-kit push — no migration files in POC mode)
pnpm db:push

# Seed demo CPF, sectors, patrollers, vehicles, residents, emergency services, incidents.
# The seed script is idempotent: it TRUNCATEs and re-inserts on every run, so you can
# replay it as often as you like during dev without unique-constraint collisions.
pnpm db:seed
```

> **Note**: `db:seed` runs as plain Node ESM (`node src/db/seed.mjs`) — no TypeScript compilation, no tsx, no esbuild. If you see an error about tsx or esbuild versions, see the **Troubleshooting** section at the end of this document.

You should see `[seed] done.` with four demo accounts:

| Call sign | Password     | Role              |
| --------- | ------------ | ----------------- |
| `WV01`    | `Admin1234!` | admin             |
| `WV46`    | `Patrol123!` | call_centre_agent |
| `WC29`    | `Patrol123!` | patroller         |
| `WC46`    | `Patrol123!` | patroller         |

Verify in the Neon dashboard — go to the **Tables** tab and confirm `patrollers`, `residents`, `emergency_services`, `incidents` have rows.

> ⚠️ **Never paste your real connection string into any file tracked by git** (including this one). Keep it in your shell environment or in `apps/api/.dev.vars`, which is in `.gitignore`. If you leak a password, rotate it immediately via the Neon console → Project → Settings → Reset password.

---

## 3 · Create the Cloudflare account (2 minutes)

1. Go to **https://dash.cloudflare.com/sign-up** and register (email + password).
2. Skip the "Add a website" prompt — you don't need a custom domain for the POC.
3. Once in the dashboard, go to **Workers & Pages** in the left nav. If asked to pick a subdomain, choose something like `yourname.workers.dev`. Every Worker you deploy will live at `<worker-name>.<yourname>.workers.dev`.

No credit card required for the Free plan.

---

## 4 · Deploy the API to Cloudflare Workers (5 minutes)

### 4.1 — Log in with Wrangler

```bash
wrangler login
```

This opens a browser window — click **Allow** to grant Wrangler access to your account.

### 4.2 — Set the secrets

```bash
cd apps/api

# Paste the same Neon connection string you used for seeding
wrangler secret put DATABASE_URL
# (paste when prompted, press Enter)

# Generate and paste a random JWT signing key
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
wrangler secret put JWT_SECRET
# (paste the output of the previous command)

# CORS origins — set these to comma-separated allowed front-ends.
# Start with just your admin portal URL once you have it. For now:
wrangler secret put CORS_ORIGINS
# paste: *
# (we'll tighten this to specific origins after step 5)
```

> **Wrangler 4.x multi-environment warning.** If you ever add an `[env.xxx]` block to `wrangler.toml`, Wrangler 4 requires every `secret put`/`deploy` command to include `--env=""` (top-level) or `--env <name>` so you don't accidentally write a secret to the wrong environment. The `wrangler.toml` in this repo uses a single top-level environment precisely so no `--env` flag is needed. See §11.6 of Troubleshooting if you re-introduce environments later.

### 4.3 — Deploy

```bash
wrangler deploy
```

Wrangler will print a URL like:

```
Published patrol-log-api (1.22 sec)
  https://patrol-log-api.<yourname>.workers.dev
```

**Save this URL** — it's your API base URL. Call it `API_URL` from now on.

### 4.4 — Smoke test

**macOS / Linux / Git Bash (real curl):**

```bash
curl https://patrol-log-api.<yourname>.workers.dev/health
# → {"ok":true,"ts":"2026-04-10T..."}

curl -X POST https://patrol-log-api.<yourname>.workers.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"call_sign":"WV01","password":"Admin1234!","device_id":"test"}'
# → {"device_token":"eyJhbGciOiJI...","patroller":{...}}
```

**Windows PowerShell:** `curl` is an alias for `Invoke-WebRequest` and does _not_ accept `-H`/`-d`. Use `Invoke-RestMethod` (cleanest), or call `curl.exe` explicitly.

```powershell
# Health check
Invoke-RestMethod https://patrol-log-api.<yourname>.workers.dev/health

# Login
$body = @{
  call_sign = "WV01"
  password  = "Admin1234!"
  device_id = "test"
} | ConvertTo-Json

$res = Invoke-RestMethod `
  -Uri https://patrol-log-api.<yourname>.workers.dev/auth/login `
  -Method POST `
  -ContentType "application/json" `
  -Body $body

$res.device_token              # should print a long JWT
$res.patroller.access_level    # should print "admin"
```

If the login returns a token, the API is live and talking to Neon. 🎉

> Alternative: skip curl entirely and smoke-test via the admin portal after §5. If you can log in at `https://patrol-log-admin.pages.dev` with `WV01` / `Admin1234!` and see the Dashboard render, the API is working end-to-end (auth + CORS + `/admin/stats`).

---

## 5 · Deploy the admin portal to Cloudflare Pages (5 minutes)

### 5.1 — Build locally to catch typos

**macOS / Linux / Git Bash:**

```bash
cd ../admin
VITE_API_BASE_URL="https://patrol-log-api.<yourname>.workers.dev" pnpm build
```

**Windows PowerShell** — inline `VAR=value command` is bash syntax and won't work. Set the env var first, then run the build:

```powershell
cd ..\admin
$env:VITE_API_BASE_URL = "https://patrol-log-api.<yourname>.workers.dev"
pnpm build
```

Either way produces `apps/admin/dist/` — a static site with a `_redirects` rule for SPA routing.

### 5.2 — Deploy with Wrangler

```bash
# First deploy creates the Pages project automatically
wrangler pages deploy dist --project-name patrol-log-admin
```

Wrangler will print:

```
✨ Deployment complete! Take a peek over at https://<hash>.patrol-log-admin.pages.dev
```

### 5.3 — Promote the URL

Every deploy is on a `<hash>.patrol-log-admin.pages.dev` URL. The **canonical** URL — `https://patrol-log-admin.pages.dev` — is automatically aliased to the latest production deploy. Use that one.

### 5.4 — Tighten CORS on the API

Go back to the API and replace the `*` CORS origin with the real admin URL:

```bash
cd ../api
wrangler secret put CORS_ORIGINS
# paste: https://patrol-log-admin.pages.dev,https://44100d2a.patrol-log-admin.pages.dev,http://localhost:5173,http://localhost:19006,http://localhost:8081
wrangler deploy
```

### 5.5 — Smoke test the admin portal

Open `https://patrol-log-admin.pages.dev` and log in with `WV01` / `Admin1234!`. You should land on the Dashboard and see counts for active patrols, residents, and members.

---

## 6 · Set the mobile app's API URL

Edit `apps/mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "apiBaseUrl": "https://patrol-log-api.<yourname>.workers.dev"
    }
  }
}
```

Commit this change. It's what Expo bundles into the JS that ships to devices.

---

## 7 · Distribute the mobile app to 10 testers

You've got two free paths — one per platform.

### 7.a — iOS testers (zero Apple fees)

iOS patrollers install **Expo Go** from the App Store, then scan a QR code that loads your app's JS bundle.

```bash
cd apps/mobile
pnpm start
```

Expo prints a QR code and a URL like `exp://u.expo.dev/update/...`. Tell each iOS tester:

1. Install **Expo Go** from the App Store.
2. Open the iPhone camera and scan this QR code: _(send the printout or screenshot)_.
3. Tap the notification to open in Expo Go.

Downside: requires your dev machine to be reachable. For remote testers, run `pnpm start --tunnel` — Expo creates an ngrok-style tunnel and the QR code works anywhere in the world. Takes ~30 s to spin up the first time.

For persistent iOS distribution without a paid Apple Developer account, your options are:

- Keep using Expo Go + tunnel (fine for a POC)
- Publish an **EAS Update** channel and tell testers to open your project in Expo Go via its public URL (no rebuild per JS change)

### 7.b — Android testers (APK via EAS Build free tier)

Android doesn't need an App Store listing for testing — you can install APKs directly (sideloading). EAS Build's free hobby tier gives you **30 builds/month**, enough for weeks of POC iteration.

**This is the recommended path for distributing to real patrollers** — it avoids every "Metro can't connect" and "same WiFi" pitfall because the APK is fully self-contained and bakes in the deployed Worker URL from `app.json`.

The repo ships with `apps/mobile/eas.json` already configured:

- `preview` profile → Android **APK** (sideloadable, no Play Store)
- `production` profile → Android **AAB** (Play Store-ready, for later)

```powershell
cd apps\mobile

# One-time: install the EAS CLI
npm install -g eas-cli

# One-time: log into (or sign up for) a free Expo account
eas login

# One-time: link this project to your Expo account
eas init
# answer "Yes" to "Create new EAS project?"
# writes an EAS project ID into app.json

# Build the preview APK in the cloud (~10–15 min in free tier queue)
eas build --platform android --profile preview
```

**First build only:** EAS asks if it can generate and securely store an Android keystore on your behalf. Answer **Yes** — subsequent builds reuse the same keystore automatically, so every APK you ship is signed by the same key.

When the build finishes, EAS prints:

```
🪴 Android preview build has been completed!

    You can download it from: https://expo.dev/artifacts/eas/<hash>.apk
```

### Distributing to testers

Send the download URL to each Android tester via WhatsApp/SMS/email. On the phone:

1. Open the URL in the phone's browser (Chrome/Samsung Internet).
2. Tap **Install** when the download completes.
3. Android will pop up: "For your security, your phone currently isn't allowed to install unknown apps from this source." → tap **Settings** → toggle **Allow from this source** → go back → tap **Install** again.
4. Launch **Patrol Log** from the home screen and log in.

The APK is ~40–60 MB. If any tester can't get "unknown sources" approved by their MDM, upload the same APK to Google Drive or Firebase App Distribution and share that link instead.

### 7.c — Updating the app after changes

Two options:

- **EAS Update** (recommended for quick iteration): push a new JS bundle to all installed clients without rebuilding:

  ```bash
  eas update --channel preview --message "Fix: stand-down KMs"
  ```

  Testers relaunch the app and get the update in ~5 seconds.

- **Rebuild**: only needed when you change native modules (new `expo install <native>`) or permissions in `app.json`.

---

## 8 · Hardening checklist before handing the POC to real patrollers

These are not gates for the POC but should be done before anything resembling production:

| Item                                                                                                  | Why                                                              |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Replace `drizzle-kit push` with generated migrations                                                  | Auditable schema changes                                         |
| Switch realtime from polling to Durable Objects + WebSockets                                          | Paid plan, 30 s → sub-second pins                                |
| Move login rate-limiting from the DB table to the Cloudflare Rate Limiting API or KV                  | Protects against DB read amplification under attack              |
| Add `expo-task-manager` + `expo-background-fetch` for heartbeats                                      | True background GPS (patrollers won't keep app foregrounded)     |
| Enable **audit retention policy**                                                                     | POPIA requires data-minimization on audit logs                   |
| Add a custom domain (`api.patrol-log.example.co.za`)                                                  | Recommended — put Cloudflare Access in front of the admin portal |
| Rotate `JWT_SECRET` via `wrangler secret put` and revoke existing device sessions in one admin action | Compromise recovery                                              |
| Set up **Cloudflare Pages preview deployments** for PR-based review                                   | Catches regressions before prod                                  |

---

## 9 · Cost check

At the end of this runbook you should be paying **R0 / $0 / €0** per month:

| Service            | Free tier limit                             | Expected POC load                    | Headroom |
| ------------------ | ------------------------------------------- | ------------------------------------ | -------- |
| Cloudflare Workers | 100 000 requests/day                        | 10 patrollers × ~200 req/day = 2 000 | 50×      |
| Cloudflare Pages   | Unlimited static + 100 000 function req/day | Admin portal is purely static        | ∞        |
| Neon Postgres      | 0.5 GB storage, auto-sleep after 5 min idle | POC dataset < 50 MB                  | 10×      |
| Expo Go            | Unlimited client installs                   | 10 testers on iOS                    | ∞        |
| EAS Build          | 30 builds/month (hobby)                     | ~5 Android builds during POC         | 6×       |

If the POC is wildly successful and any of these fill up, the upgrade path for each is linear and well-documented on the respective vendor's pricing page. Cloudflare Workers Paid is $5/month and raises every limit by 100×.

---

## 10 · Rollback

Every step in this runbook is reversible:

- **Roll back the API**: `wrangler rollback` or `wrangler deployments list` + `wrangler rollback <deployment-id>`
- **Roll back the admin portal**: the Pages dashboard's **Deployments** tab has a one-click "Rollback to this deployment"
- **Roll back the database**: Neon supports branching — `neon branches create --from-head` before every schema change gives you an instant restore point
- **Revoke all mobile sessions**: hit `POST /admin/devices/:id/revoke` from the admin portal — or bulk SQL in Neon: `UPDATE devices SET status = 'revoked'`

---

## 11 · Troubleshooting

### 11.1 — `pnpm install` fails with `esbuild postinstall: Expected "0.27.7" but got "0.17.19"`

This is a well-known pnpm-on-Windows issue when multiple esbuild versions are pulled in (drizzle-kit, wrangler, vite, and tsx each ship with different esbuild major versions). On Windows, pnpm's hoisting occasionally causes one esbuild's postinstall self-check to resolve a different version's binary.

**The root `package.json` in this repo already contains a `pnpm.onlyBuiltDependencies` allowlist** that excludes esbuild from postinstall scripts. This is a permanent fix — the postinstall is purely a version-check and skipping it does not break esbuild at runtime. If you still hit the error after cloning, force a clean install:

```powershell
# Windows PowerShell — from the repo root
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force apps\api\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\admin\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\mobile\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\shared\node_modules -ErrorAction SilentlyContinue
pnpm store prune
pnpm install
```

```bash
# macOS/Linux
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm store prune
pnpm install
```

If the error survives all of that, check for a leftover `ESBUILD_BINARY_PATH` environment variable or a globally installed esbuild:

```powershell
echo $env:ESBUILD_BINARY_PATH           # should be empty
where.exe esbuild                        # should print nothing
```

Clear both if present (`Remove-Item Env:ESBUILD_BINARY_PATH`, `npm uninstall -g esbuild`).

### 11.2 — `pnpm db:seed` fails with `Host version "0.27.7" does not match binary version "0.17.19"`

Older checkouts of this repo used `tsx` to run the seed script, which pulled its own esbuild version and hit the same hoisting collision at runtime. The current seed script is pure Node ESM (`apps/api/src/db/seed.mjs`) and is invoked as `node src/db/seed.mjs` — no tsx, no esbuild.

If you see this error after an update, pull the latest `apps/api/package.json` (the `db:seed` script should read `node src/db/seed.mjs`) and the corresponding `apps/api/src/db/seed.mjs`. Then reinstall and retry:

```bash
pnpm install
pnpm db:seed
```

### 11.3 — `wrangler dev` can't find `.dev.vars`

`.dev.vars` lives at `apps/api/.dev.vars` (not at the repo root). Create it from the example:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Then edit the file and fill in `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS`. Generate the JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 11.4 — Mobile app can't reach `http://localhost:8787` from a physical phone

`localhost` on the phone means "the phone itself", not your laptop. For on-device testing, use one of these:

| Scenario                     | `apiBaseUrl` to use                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Phone + laptop on same WiFi  | `http://192.168.x.x:8787` (your laptop's LAN IP from `ipconfig` or `ifconfig`)             |
| Phone on 4G or remote tester | `cloudflared tunnel --url http://localhost:8787` → use the printed `trycloudflare.com` URL |
| Easiest for real tests       | Deploy the API to Workers once (`pnpm deploy:api`), point mobile at the Worker URL         |

### 11.5 — `NODE_TLS_REJECT_UNAUTHORIZED=0` warning on every pnpm command

Your shell or a startup script has disabled TLS certificate validation globally. This is usually a corporate proxy workaround. It's not blocking anything in this runbook but it means **every outbound HTTPS call from Node skips certificate validation**, which is a security concern for production. Check:

```powershell
echo $env:NODE_TLS_REJECT_UNAUTHORIZED
```

If it prints `0`, unset it (`Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED`) unless you know you need it for your network. Before deploying to production, ensure this is _not_ set in any shell that runs `wrangler deploy`.

### 11.6 — PowerShell doesn't accept `VAR=value command` inline env var syntax

Bash-style `VITE_API_BASE_URL=... pnpm build` is a Unix shell feature that sets an env var just for one command. PowerShell has no equivalent one-liner — you have to set the env var on its own line first, then run the command:

```powershell
$env:VITE_API_BASE_URL = "https://patrol-log-api.<yourname>.workers.dev"
pnpm build

# Or on a single line with a semicolon:
$env:VITE_API_BASE_URL = "https://..."; pnpm build
```

The env var persists for the rest of the PowerShell session (until you close the window). To clear it manually:

```powershell
Remove-Item Env:VITE_API_BASE_URL
```

### 11.7 — `curl` in PowerShell fails with `Cannot bind parameter 'Headers'`

In Windows PowerShell, `curl` is an alias for `Invoke-WebRequest`, which has completely different argument syntax — no `-H`, no `-d`. The real curl binary still exists on Windows 10+, but you have to call it explicitly.

**Fix A — use the real curl binary:**

```powershell
curl.exe https://patrol-log-api.<yourname>.workers.dev/health
```

**Fix B — use PowerShell-native cmdlets (preferred on Windows):**

```powershell
Invoke-RestMethod https://patrol-log-api.<yourname>.workers.dev/health

$body = @{
  call_sign = "WV01"
  password  = "Admin1234!"
  device_id = "test"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri https://patrol-log-api.<yourname>.workers.dev/auth/login `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

`Invoke-RestMethod` auto-parses the JSON response into a PowerShell object, so you can immediately inspect fields: `$res.device_token`, `$res.patroller.access_level`.

### 11.8 — `wrangler secret put` warns "Multiple environments are defined... no target environment was specified"

Wrangler 4.x tightened the behavior for multi-environment configs. If your `wrangler.toml` contains any `[env.xxx]` block — even just `[env.production.vars]` — every `secret put`, `deploy`, and `tail` command requires an explicit `--env` flag so you don't accidentally write a secret to the wrong environment.

The `wrangler.toml` in this repo is intentionally single-environment (only a top-level `[vars]` block, no `[env.xxx]`), so no flag is needed. If you re-introduce environments later:

```bash
# Target the top-level environment explicitly
wrangler secret put DATABASE_URL --env=""

# Target a named environment
wrangler secret put DATABASE_URL --env production
wrangler deploy --env production
```

If you see this warning mid-command, you can also just press Enter and paste the value — the warning is a warning, not an error, and the secret is still written to the top-level environment by default.

---

## Quick reference

```bash
# Local dev
pnpm dev:api         # http://localhost:8787
pnpm dev:admin       # http://localhost:5173
pnpm dev:mobile      # Expo QR

# Deploy
pnpm deploy:api      # Cloudflare Workers
pnpm deploy:admin    # Cloudflare Pages
eas build -p android --profile preview   # Android APK
eas update --channel preview              # OTA JS update

# Database
pnpm db:push         # Apply schema changes (POC mode, drizzle-kit push)
pnpm db:generate     # Produce migration files (production mode)
pnpm db:seed         # Truncate + reseed demo data (node src/db/seed.mjs)

# Blueprints
pnpm fdl:check       # Validate blueprints against schema
```

That's it. From zero to 10 patrollers tapping Stand Down on their phones — no credit card, no VPS, no servers to manage.
