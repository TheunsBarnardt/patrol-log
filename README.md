# Patrol Log

CPF patrol logging system generated from FDL (Feature Definition Language) blueprints.

- **Mobile app** — Expo / React Native (iOS + Android + web)
- **Admin portal** — Vite + React + Tailwind (web)
- **API** — Hono on Cloudflare Workers
- **Database** — Neon serverless Postgres + Drizzle ORM
- **Specs** — 8 FDL blueprints under `blueprints/**/*.blueprint.yaml`

All three apps share a `packages/shared` workspace with TypeScript types, error codes, and a typed API client that guarantees the wire format matches the blueprints.

## Repository layout

```
patrol-log/
├── apps/
│   ├── api/              Cloudflare Workers API (Hono + Drizzle + Neon)
│   ├── mobile/           Expo React Native app
│   └── admin/            Vite + React admin portal
├── packages/
│   └── shared/           Types, error codes, API client
├── blueprints/           FDL blueprints (source of truth)
│   ├── auth/             patroller-login
│   ├── workflow/         commence-patrol, stand-down-patrol
│   └── data/             hotspots-map, residents-directory, members-directory,
│                         emergency-contacts-directory, live-patroller-map
├── schema/               FDL meta-schema (validator input)
├── docs/fdl-brainstorm/  Brainstorm plan + architecture notes
└── CLOUDFLARE_DEPLOY.md  Zero-to-live deployment runbook (free tiers)
```

## Prerequisites

- **Node.js ≥ 20**
- **pnpm ≥ 9** (`npm install -g pnpm`)
- **Neon** account (free) — `https://neon.tech`
- **Cloudflare** account (free) — `https://dash.cloudflare.com`
- **Expo Go** app on your test phones (free, iOS + Android)
- For Android APK distribution: **EAS** account (free hobby tier)

## First run (local dev)

```bash
# 1. Install dependencies across all workspaces
pnpm install

# 2. Create a Neon database and grab the connection string.
#    Go to https://console.neon.tech → New Project → copy the "DATABASE_URL"
#    (format: postgresql://user:password@ep-xxx.region.aws.neon.tech/patrol_log?sslmode=require)

# 3. Create apps/api/.dev.vars from the example
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Edit the file and paste your DATABASE_URL and a random JWT_SECRET:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 4. Create the database schema (Drizzle push — no migration files for POC)
DATABASE_URL="postgresql://..." pnpm db:push

# 5. Seed demo data (CPF, sectors, patrollers, vehicles, residents, etc.)
DATABASE_URL="postgresql://..." pnpm db:seed

# 6. Start the API locally (http://localhost:8787)
pnpm dev:api

# 7. In a second terminal, start the admin portal (http://localhost:5173)
pnpm dev:admin

# 8. In a third terminal, start the Expo app (scan the QR with Expo Go)
pnpm dev:mobile
```

## Seeded accounts (for testing)

| Call sign | Password    | Role              | Use for                             |
| --------- | ----------- | ----------------- | ----------------------------------- |
| `<YOUR_ADMIN_CALL_SIGN>`    | `<YOUR_ADMIN_PASSWORD>` | admin             | Admin portal login, full access     |
| `WV46`    | `Patrol123!` | call_centre_agent | Dispatch view of live patroller map |
| `WC29`    | `Patrol123!` | patroller         | Mobile app, commence/stand-down     |
| `WC46`    | `Patrol123!` | patroller         | Mobile app, second patroller        |

## Mapping blueprints to code

Every generated file has a `// FDL: blueprints/...` comment pointing at its source blueprint. Running `pnpm fdl:check` revalidates all blueprints against `schema/blueprint.schema.yaml`.

| Blueprint                                      | API route                             | Screen                       | Admin page                      |
| ---------------------------------------------- | ------------------------------------- | ---------------------------- | ------------------------------- |
| `auth/patroller-login`                         | `/auth/login`, `/auth/resume`         | `LoginScreen`                | `LoginPage`                     |
| `workflow/commence-patrol`                     | `POST /patrols/commence`              | `CommencePatrolScreen`       | —                               |
| `workflow/stand-down-patrol`                   | `POST /patrols/:id/stand-down`        | `ActivePatrolScreen`         | `PatrolsPage` (view/force-close) |
| `data/hotspots-map`                            | `GET /hotspots`                       | `HotspotsMapScreen`          | —                               |
| `data/residents-directory`                     | `GET /directory/residents`            | `ResidentsScreen`            | `ResidentsPage`                 |
| `data/members-directory`                       | `GET /directory/members`              | `MembersScreen`              | `MembersPage`                   |
| `data/emergency-contacts-directory`            | `GET /directory/emergency-contacts`   | `EmergencyContactsScreen`    | `EmergencyServicesPage`         |
| `data/live-patroller-map`                      | `/live-map/heartbeat`, `/snapshot`    | `LivePatrollerMapScreen`     | —                               |

## POC scope and limitations

This is a POC on free tiers. Deliberately simplified:

- **Realtime is HTTP polling**, not WebSockets. Clients POST heartbeats every 30 s and GET `/live-map/snapshot` every 30 s. Upgrading to Durable Objects + WebSockets is a drop-in once you move to the Workers Paid plan.
- **Database migrations** use `drizzle-kit push` (no migration files) because we're iterating fast. Switch to `drizzle-kit generate` + `migrate` before production.
- **Rate limiting** is against the `login_attempts` table. For real scale, replace with Cloudflare's Rate Limiting API or a KV-backed counter.
- **Background heartbeats** run in foreground only (`setInterval`). For true background execution use `expo-task-manager` + `expo-background-fetch`.
- **EAS builds** are only needed for Android APK distribution to testers. iOS testers use Expo Go with a QR code — no Apple Developer account required.

## Deployment

See **`CLOUDFLARE_DEPLOY.md`** for a complete zero-to-live runbook covering:

1. Creating free accounts (Cloudflare, Neon, Expo)
2. Deploying the API to Cloudflare Workers
3. Deploying the admin portal to Cloudflare Pages
4. Configuring the mobile app against the deployed API
5. Distributing the app to 10 test patrollers (Android APK + iOS Expo Go)

## License

MIT
