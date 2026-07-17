// Demo data seeder for Cloudflare D1 (SQLite).
// Uses the D1 binding from the worker environment.
//
// Run with:
//   LOCAL:  npx wrangler d1 execute patrol-log-db --local --command "SELECT 1"
//   Then:   node --experimental-fetch src/db/seed-d1.mjs
//
// Or use drizzle-orm/d1 directly via Miniflare for local testing.
// For production: use wrangler d1 execute with a .sql file.

import { scryptAsync } from "@noble/hashes/scrypt";

const N = 2048, r = 8, p = 1, DK_LEN = 32;

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, "binary").toString("base64url");
}

async function hash(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const dk = await scryptAsync(password, salt, { N, r, p, dkLen: DK_LEN });
  return `scrypt$${N}$${r}$${p}$${b64(salt)}$${b64(dk)}`;
}

// Helper: generate a hex UUID (D1's lower(hex(randomblob(16))))
function uuid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

// We need a D1 connection. For local dev, we use the SQLite file.
// For production, this script is replaced by wrangler d1 execute commands.
async function main() {
  console.log("[seed-d1] D1 seeding requires wrangler d1 execute or Miniflare.");
  console.log("[seed-d1] Steps:");
  console.log("[seed-d1]   1. Create DB:    wrangler d1 create patrol-log-db");
  console.log("[seed-d1]   2. Push schema: pnpm db:push  (uses drizzle-kit push to D1)");
  console.log("[seed-d1]   3. Seed data:   See seed-data.sql in the repo");
  console.log("[seed-d1]   4. Or use:      npx wrangler d1 execute patrol-log-db --remote --command '@seed-data.sql'");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
