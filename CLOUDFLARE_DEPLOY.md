# Patrol Log — Cloudflare Deployment Guide

This guide covers deploying Patrol Log on Cloudflare with **D1 (SQLite)** as the database and **Cloudflare Pages** for the admin frontend. No Supabase, no Neon, no Firebase — fully self-contained on Cloudflare.

---

## Architecture

```
┌─────────────┐     HTTPS      ┌──────────────────────────┐
│  Mobile App │  ───────────►  │  Cloudflare Workers API   │
│  (Expo/RN)  │                │  (Hono + Drizzle + D1)    │
└─────────────┘                └──────────┬───────────────┘
                                           │ D1 Binding
                                    ┌──────▼───────┐
                                    │  Cloudflare   │
                                    │   D1 (SQLite) │
                                    └───────────────┘

┌─────────────┐     HTTPS      ┌──────────────────────────┐
│  Admin Web  │  ───────────►  │  Cloudflare Pages (static)│
│  (React)    │                │  (Vite build + _redirects)│
└─────────────┘                └──────────────────────────┘
```

### Key changes from the original architecture:

| Before                        | After                          |
|-------------------------------|--------------------------------|
| Neon/PostgreSQL               | Cloudflare D1 (SQLite)         |
| Firebase FCM push             | In-app messages only           |
| Supabase (implied)            | Fully on Cloudflare            |
| Hosted API                    | Cloudflare Workers             |
| Hosted admin                  | Cloudflare Pages               |

---

## Prerequisites

1. **Cloudflare account** (free tier works for POC, paid for production)
2. **Node.js 20+** and **pnpm 9+**
3. **Wrangler CLI**: `npm install -g wrangler`
4. **Git**

---

## Step 1: Install Dependencies

```bash
cd /path/to/patrol-log
pnpm install
```

This installs all workspace packages. Key changes in dependencies:
- Removed: `@neondatabase/serverless`
- Added: `miniflare` (for local D1 testing)
- Kept: `drizzle-orm` (now uses D1 adapter), `hono`, `jose`, `@noble/hashes`

---

## Step 2: Create D1 Database

```bash
cd apps/api

# Create the D1 database (production)
wrangler d1 create patrol-log-db

# Note the database_id from the output, then update wrangler.toml:
# [[d1_databases]]
# binding = "DB"
# database_name = "patrol-log-db"
# database_id = "<YOUR_DB_ID>"
```

---

## Step 3: Push Schema to D1

```bash
# Generate migration files
pnpm db:generate

# Push schema to D1 (local or remote)
# For local testing:
npx wrangler d1 execute patrol-log-db --local --command ".schema"

# Push the Drizzle schema to your D1 database:
npx wrangler d1 execute patrol-log-db --remote --command ".read drizzle/000_initial.sql"

# Or use drizzle-kit push (requires D1 connector):
# pnpm db:push
```

The schema (`apps/api/src/db/schema.ts`) has been rewritten for SQLite:
- `pgTable` → `sqliteTable`
- `uuid()` → `text()` with `lower(hex(randomblob(16)))` defaults
- `timestamp()` → `text()` with `datetime('now')` defaults
- `doublePrecision()` → `real()`
- `boolean()` → `integer({ mode: "boolean" })`
- `jsonb()` → `text({ mode: "json" })`
- Indexes use `index()` and `uniqueIndex()` from `sqlite-core`

---

## Step 4: Seed Demo Data

```bash
# Option A: Use the Node.js seed script (requires Miniflare)
node src/db/seed-d1.mjs

# Option B: Use SQL directly (for production)
wrangler d1 execute patrol-log-db --remote --command "DELETE FROM cpfs;"
wrangler d1 execute patrol-log-db --remote --file src/db/seed-data.sql
```

Demo accounts after seeding:
| Call Sign | Password     | Role                |
|-----------|-------------|---------------------|
| WV01      | Admin1234!  | Admin               |
| WV46      | Patrol123!  | Call Centre Agent   |
| WC29      | Patrol123!  | Patroller           |
| WC46      | Patrol123!  | Patroller           |

---

## Step 5: Configure Environment

### Local Development

Create `apps/api/.dev.vars`:
```
JWT_SECRET=your-super-secret-jwt-key-change-this
CORS_ORIGINS=http://localhost:5173,http://localhost:8081
ENV=development
APP_NAME=Patrol Log API (Dev)
```

### Production

```bash
cd apps/api
wrangler secret put JWT_SECRET
wrangler secret put CORS_ORIGINS  # e.g., "https://admin.patrol-log.example.com"
```

---

## Step 6: Deploy the API

```bash
cd apps/api

# Build and deploy
pnpm deploy

# Or with a specific environment:
wrangler deploy --env production
```

The API will be available at:
```
https://patrol-log-api.<your-account>.workers.dev
```

### Health check
```bash
curl https://patrol-log-api.<your-account>.workers.dev/health
# Should return: {"ok":true,"ts":"2026-..."}
```

---

## Step 7: Deploy the Admin Portal

```bash
cd apps/admin

# Build
pnpm build

# Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name patrol-log-admin
```

Or set up automatic deployments via GitHub integration:
1. Connect your repo to Cloudflare Pages
2. Set build command: `pnpm build`
3. Set output directory: `apps/admin/dist`
4. Add environment variable: `VITE_API_BASE_URL=https://patrol-log-api.<account>.workers.dev`

---

## Step 8: Configure Mobile App

### Update API URL

Edit `apps/mobile/app.json`:
```json
"extra": {
  "apiBaseUrl": "https://patrol-log-api.<your-account>.workers.dev"
}
```

### Build for Production

```bash
cd apps/mobile

# Preview (development)
pnpm start

# Android production build
pnpm build:android:prod

# iOS production build
eas build -p ios --profile production
```

### For Physical Device Testing

Use Metro tunneling:
```bash
npx expo start --tunnel
```

Then update `app.json` to point at the tunnel URL:
```json
"extra": {
  "apiBaseUrl": "tcp://your-tunnel-url.exp.direct"
}
```

Or use your local IP for LAN testing:
```json
"extra": {
  "apiBaseUrl": "http://192.168.1.100:8787"
}
```

---

## Live Location Tracking

The live location feature works via HTTP polling (no WebSocket needed):

1. **Mobile app**: While on patrol, the `startHeartbeat()` function POSTs GPS coordinates to `/live-map/heartbeat` every 30 seconds
2. **API**: Stores location in the `live_pins` D1 table and checks sector boundaries
3. **Admin/Mobile map**: Polls `/live-map/snapshot` every 10-30 seconds and updates the Leaflet map

### Key settings:
- Heartbeat interval: 30 seconds (`apps/mobile/src/lib/heartbeat.ts`)
- Snapshot poll interval: 10 seconds (mobile), 30 seconds (admin)
- Stale threshold: 2 minutes
- Rate limit: 1 heartbeat per 20 seconds per patrol

---

## Messaging (In-App Only)

Firebase Cloud Messaging has been removed. All notifications are now in-app:

- Messages are stored in the `messages` D1 table
- Channels (broadcast, sector, direct) are managed in the database
- Out-of-sector alerts create system messages in the sector channel
- Mobile app shows local notifications for urgent messages via `expo-notifications`

---

## Security Notes

1. **JWT_SECRET**: Change the default in production. Use `wrangler secret put JWT_SECRET` to store securely.
2. **CORS_ORIGINS**: Restrict to your admin domain in production.
3. **Password hashing**: Uses scrypt (N=2048) — compatible with Workers. Consider increasing N=16384 on paid plans.
4. **Heartbeat signatures**: HMAC-SHA256 signed with the device token's JTI.

---

## Troubleshooting

### "No such table" errors
```bash
# Re-push the schema
npx wrangler d1 execute patrol-log-db --remote --command ".read drizzle/000_initial.sql"
```

### D1 binding not found
Check `wrangler.toml` has:
```toml
[[d1_databases]]
binding = "DB"
database_name = "patrol-log-db"
database_id = "<your-db-id>"
```

### CORS errors from mobile app
Ensure `CORS_ORIGINS` in `.dev.vars` includes your Metro dev server URL:
```
CORS_ORIGINS=http://localhost:8081,http://localhost:19000,http://localhost:5173
```

### Schema push fails locally
```bash
# Create local SQLite file for testing
npx wrangler d1 execute patrol-log-db --local --command "CREATE TABLE IF NOT EXISTS _placeholder (id INTEGER);"
```

---

## Cost Estimate (Free Tier)

| Service       | Free Tier Limit     | Patrol Log Usage     |
|---------------|--------------------|----------------------|
| Workers       | 100k req/day       | ~10k req/day (POC)  |
| D1            | 5M reads/day       | ~1M reads/day       |
| D1            | 100k writes/day    | ~10k writes/day     |
| Pages         | Unlimited          | Static admin site   |
| KV (optional) | 1M ops/day         | Not used            |

For production with 100+ patrollers, the paid Workers plan ($5/mo) is recommended.
