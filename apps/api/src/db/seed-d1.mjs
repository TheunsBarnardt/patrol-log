// Demo data seeder for D1.
// Run locally with: node src/db/seed-d1.mjs
// Creates a local SQLite DB, pushes schema, then seeds data.
//
// Prerequisites:
//   1. npx wrangler d1 create patrol-log-db
//   2. pnpm db:push  (creates tables via drizzle-kit)
//   3. node src/db/seed-d1.mjs  (inserts demo data)

import { drizzle } from "drizzle-orm/d1";
import { scryptAsync } from "@noble/hashes/scrypt";
import * as schema from "./schema.js";

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

function uuid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function main() {
  // Create a local D1 database via Miniflare
  const { Miniflare } = await import("miniflare");

  const mf = new Miniflare({
    d1Persist: true,
    d1Databases: {
      DB: "patrol-log-local",
    },
    modules: true,
  });

  // Create the D1 database if it doesn't exist
  try {
    await mf.d1("patrol-log-local").execute("SELECT 1");
  } catch {
    // Database might not exist yet; drizzle-kit push will create it
  }

  const db = drizzle(mf.d1("patrol-log-local"), { schema });

  console.log("[seed] wiping existing demo data...");
  // Delete in reverse dependency order.
  // NEVER delete systemBackups — seed must not destroy restore points.
  await db.delete(schema.messageChannelMembers);
  await db.delete(schema.messageReads);
  await db.delete(schema.messages);
  await db.delete(schema.messageChannels);
  await db.delete(schema.pushTokens);
  await db.delete(schema.auditLog);
  await db.delete(schema.patrolEscalationEvents);
  await db.delete(schema.patrolBreadcrumbs);
  await db.delete(schema.patrolMembers);
  await db.delete(schema.patrols);
  await db.delete(schema.devices);
  await db.delete(schema.loginAttempts);
  await db.delete(schema.nextOfKin);
  await db.delete(schema.incidents);
  await db.delete(schema.emergencyServices);
  await db.delete(schema.residents);
  await db.delete(schema.vehicles);
  await db.delete(schema.livePins);
  await db.delete(schema.patrollers);
  await db.delete(schema.sectors);
  await db.delete(schema.cpfs);
  // schema.systemBackups intentionally NOT deleted

  console.log("[seed] inserting CPF + sector...");
  const cpfId = uuid();
  const sectorId = uuid();
  await db.insert(schema.cpfs).values({ id: cpfId, name: "Wierdabrug CPF", province: "Gauteng" });
  await db.insert(schema.sectors).values({ id: sectorId, cpfId, name: "Wierdabrug Sector 1" });

  console.log("[seed] hashing passwords...");
  const adminHash = await hash("Admin1234!");
  const patrolHash = await hash("Patrol123!");

  console.log("[seed] inserting patrollers...");
  const adminId = uuid();
  const adeleId = uuid();
  const theunsId = uuid();
  const adeleBId = uuid();

  await db.insert(schema.patrollers).values([
    {
      id: adminId, cpfId, sectorId, callSign: "WV01", name: "Admin User",
      phone: "+27 72 000 0001", address: "1 CPF Street, Valhalla",
      passwordHash: adminHash, accessLevel: "admin", status: "active",
    },
    {
      id: adeleId, cpfId, sectorId, callSign: "WV46", name: "Adele Jansen van Vuuren",
      phone: "+27 72 111 1111", address: "46 Sector 1 Road, Valhalla",
      passwordHash: patrolHash, accessLevel: "call_centre_agent", status: "active",
    },
    {
      id: theunsId, cpfId, sectorId, callSign: "WC29", name: "Theuns Barnardt",
      phone: "+27 72 235 2283", address: "53a Meteor Rd Valhalla",
      passwordHash: patrolHash, accessLevel: "patroller", status: "active",
    },
    {
      id: adeleBId, cpfId, sectorId, callSign: "WC46", name: "Adele Barnardt",
      phone: "+27 72 222 2222", address: "53a Meteor Rd Valhalla",
      passwordHash: patrolHash, accessLevel: "patroller", status: "active",
    },
  ]);

  console.log("[seed] next of kin...");
  await db.insert(schema.nextOfKin).values([
    { patrollerId: theunsId, name: "Adele Barnardt", relationship: "Spouse", phone: "+27 72 222 2222" },
    { patrollerId: adeleBId, name: "Theuns Barnardt", relationship: "Spouse", phone: "+27 72 235 2283" },
  ]);

  console.log("[seed] vehicles...");
  await db.insert(schema.vehicles).values([
    { id: uuid(), cpfId, sectorId, registration: "CPF 001 GP", description: "Primary patrol bakkie", lastOdometer: 123456, status: "available" },
    { id: uuid(), cpfId, sectorId, registration: "CPF 002 GP", description: "Backup vehicle", lastOdometer: 54321, status: "available" },
  ]);

  console.log("[seed] residents...");
  const residents = [];
  for (let i = 0; i < 12; i++) {
    residents.push({ cpfId, sectorId, name: `Resident ${i + 1}`, phone: `+27 72 500 ${(1000 + i).toString().padStart(4, "0")}`, address: `${i + 1} Meteor Rd Valhalla` });
  }
  await db.insert(schema.residents).values(residents);

  console.log("[seed] emergency services...");
  await db.insert(schema.emergencyServices).values([
    { cpfId, name: "Valhalla SAPS", serviceType: "police", primaryNumber: "012 654 0100", address: "Valhalla, Centurion", priority: 10 },
    { cpfId, name: "Netcare 911", serviceType: "ambulance", primaryNumber: "082 911", priority: 20 },
    { cpfId, name: "Centurion Fire Brigade", serviceType: "fire", primaryNumber: "012 358 6666", priority: 30 },
    { cpfId, name: "ADT Armed Response", serviceType: "armed_response", primaryNumber: "086 1 12 12 12", priority: 40 },
    { cpfId, name: "Unitas Hospital", serviceType: "hospital", primaryNumber: "012 677 8000", address: "Lyttelton Manor", priority: 50 },
    { cpfId, name: "Wierdabrug Ops Room", serviceType: "ops_room", primaryNumber: "072 999 8888", priority: 5 },
  ]);

  console.log("[seed] incidents (for hotspots)...");
  const types = ["theft", "burglary", "suspicious_person", "alarm", "traffic_incident"];
  const severities = ["low", "medium", "high"];
  for (let i = 0; i < 14; i++) {
    const lat = -25.842 + (Math.random() - 0.5) * 0.02;
    const lng = 28.178 + (Math.random() - 0.5) * 0.02;
    const occurredAt = new Date(Date.now() - i * 60 * 60 * 1000 * 3);
    await db.insert(schema.incidents).values({
      cpfId, sectorId, type: types[i % 5], severity: severities[i % 3],
      lat, lng, occurredAt: occurredAt.toISOString(), description: "Demo incident",
    });
  }

  console.log("\n[seed] done! Accounts:");
  console.log("  Admin:       WV01 / Admin1234!");
  console.log("  Call centre: WV46 / Patrol123!");
  console.log("  Patroller:   WC29 / Patrol123!");
  console.log("  Patroller:   WC46 / Patrol123!");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
