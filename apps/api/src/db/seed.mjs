// Demo data seeder. Pure Node ESM — no tsx, no TypeScript, no esbuild.
// Usage: `DATABASE_URL=... pnpm db:seed`
//
// Hashing: matches apps/api/src/lib/hashing.ts (scrypt N=2048, r=8, p=1)
// so the hashes stored here can be verified by the deployed Worker.

import { neon } from "@neondatabase/serverless";
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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = neon(url);

  console.log("[seed] wiping existing demo data...");
  // Truncate in dependency order. Harmless on first run.
  await sql`TRUNCATE audit_log, patrol_escalation_events, patrol_breadcrumbs, live_pins, patrol_members, patrols, next_of_kin, devices, login_attempts, residents, emergency_services, incidents, vehicles, patrollers, sectors, cpfs RESTART IDENTITY CASCADE`;

  console.log("[seed] inserting CPF + sector...");
  const [{ id: cpfId }] = await sql`
    INSERT INTO cpfs (name, province) VALUES ('Wierdabrug CPF', 'Gauteng') RETURNING id
  `;
  const [{ id: sectorId }] = await sql`
    INSERT INTO sectors (cpf_id, name) VALUES (${cpfId}, 'Wierdabrug Sector 1') RETURNING id
  `;

  console.log("[seed] inserting patrollers...");
  const adminHash = await hash("Admin1234!");
  const patrolHash = await hash("Patrol123!");

  const [{ id: adminId }] = await sql`
    INSERT INTO patrollers (cpf_id, sector_id, call_sign, name, phone, address, password_hash, access_level, status)
    VALUES (${cpfId}, ${sectorId}, 'WV01', 'Admin User', '+27 72 000 0001', '1 CPF Street, Valhalla', ${adminHash}, 'admin', 'active')
    RETURNING id
  `;
  const [{ id: adeleId }] = await sql`
    INSERT INTO patrollers (cpf_id, sector_id, call_sign, name, phone, address, password_hash, access_level, status)
    VALUES (${cpfId}, ${sectorId}, 'WV46', 'Adele Jansen van Vuuren', '+27 72 111 1111', '46 Sector 1 Road, Valhalla', ${patrolHash}, 'call_centre_agent', 'active')
    RETURNING id
  `;
  const [{ id: theunsId }] = await sql`
    INSERT INTO patrollers (cpf_id, sector_id, call_sign, name, phone, address, password_hash, access_level, status)
    VALUES (${cpfId}, ${sectorId}, 'WC29', 'Theuns Barnardt', '+27 72 235 2283', '53a Meteor Rd Valhalla', ${patrolHash}, 'patroller', 'active')
    RETURNING id
  `;
  const [{ id: adeleBId }] = await sql`
    INSERT INTO patrollers (cpf_id, sector_id, call_sign, name, phone, address, password_hash, access_level, status)
    VALUES (${cpfId}, ${sectorId}, 'WC46', 'Adele Barnardt', '+27 72 222 2222', '53a Meteor Rd Valhalla', ${patrolHash}, 'patroller', 'active')
    RETURNING id
  `;

  console.log("[seed] next of kin...");
  await sql`
    INSERT INTO next_of_kin (patroller_id, name, relationship, phone) VALUES
      (${theunsId}, 'Adele Barnardt', 'Spouse', '+27 72 222 2222'),
      (${adeleBId}, 'Theuns Barnardt', 'Spouse', '+27 72 235 2283')
  `;

  console.log("[seed] vehicles...");
  await sql`
    INSERT INTO vehicles (cpf_id, sector_id, registration, description, last_odometer, status) VALUES
      (${cpfId}, ${sectorId}, 'CPF 001 GP', 'Primary patrol bakkie', 123456, 'available'),
      (${cpfId}, ${sectorId}, 'CPF 002 GP', 'Backup vehicle', 54321, 'available')
  `;

  console.log("[seed] residents...");
  for (let i = 0; i < 12; i++) {
    await sql`
      INSERT INTO residents (cpf_id, sector_id, name, phone, address) VALUES
        (${cpfId}, ${sectorId}, ${"Resident " + (i + 1)}, ${"+27 72 500 " + (1000 + i).toString().padStart(4, "0")}, ${i + 1 + " Meteor Rd Valhalla"})
    `;
  }

  console.log("[seed] emergency services...");
  const services = [
    { name: "Valhalla SAPS", type: "police", phone: "012 654 0100", address: "Valhalla, Centurion", priority: 10 },
    { name: "Netcare 911", type: "ambulance", phone: "082 911", address: null, priority: 20 },
    { name: "Centurion Fire Brigade", type: "fire", phone: "012 358 6666", address: null, priority: 30 },
    { name: "ADT Armed Response", type: "armed_response", phone: "086 1 12 12 12", address: null, priority: 40 },
    { name: "Unitas Hospital", type: "hospital", phone: "012 677 8000", address: "Clifton Ave, Lyttelton Manor", priority: 50 },
    { name: "Wierdabrug Ops Room", type: "ops_room", phone: "072 999 8888", address: null, priority: 5 },
  ];
  for (const s of services) {
    await sql`
      INSERT INTO emergency_services (cpf_id, name, service_type, primary_number, address, priority, sensitive, verified_at)
      VALUES (${cpfId}, ${s.name}, ${s.type}, ${s.phone}, ${s.address}, ${s.priority}, false, now())
    `;
  }

  console.log("[seed] incidents (for hotspots)...");
  const types = ["theft", "burglary", "suspicious_person", "alarm", "traffic_incident"];
  const severities = ["low", "medium", "high"];
  const now = Date.now();
  for (let i = 0; i < 14; i++) {
    const lat = -25.842 + (Math.random() - 0.5) * 0.02;
    const lng = 28.178 + (Math.random() - 0.5) * 0.02;
    const occurredAt = new Date(now - i * 60 * 60 * 1000 * 3).toISOString();
    await sql`
      INSERT INTO incidents (cpf_id, sector_id, type, severity, lat, lng, occurred_at, description)
      VALUES (${cpfId}, ${sectorId}, ${types[i % 5]}, ${severities[i % 3]}, ${lat}, ${lng}, ${occurredAt}, 'Demo incident')
    `;
  }

  console.log("\n[seed] done. Accounts:");
  console.log("  Admin:       WV01 / Admin1234!");
  console.log("  Call centre: WV46 / Patrol123!");
  console.log("  Patroller:   WC29 / Patrol123!");
  console.log("  Patroller:   WC46 / Patrol123!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
