// Local seeder: reads seed-data/cpf.json (from cpf.ods), hashes passwords,
// writes SQL, then apply with:
//   node src/db/seed-local.mjs
//   wrangler d1 execute patrol-log-db --local --file src/db/_local-seed.sql
import { scryptAsync } from "@noble/hashes/scrypt";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const N = 2048, r = 8, p = 1, DK_LEN = 32;

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, "binary").toString("base64url");
}

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await scryptAsync(password, salt, { N, r, p, dkLen: DK_LEN });
  return `scrypt$${N}$${r}$${p}$${b64(salt)}$${b64(dk)}`;
}

function uuid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

const esc = (s) => String(s ?? "").replace(/'/g, "''");

const data = JSON.parse(readFileSync(join(__dirname, "seed-data", "cpf.json"), "utf8"));
const org = data.organization;

const adminHash = await hash("Admin1234!");
const patrolHash = await hash("Patrol123!");
const cpfId = uuid();
const sectorId = uuid();

const memberIds = new Map();
for (const m of data.members) {
  memberIds.set(m.call_sign.toUpperCase(), uuid());
}

let sql = `
DELETE FROM message_channel_members;
DELETE FROM message_reads;
DELETE FROM messages;
DELETE FROM message_channels;
DELETE FROM push_tokens;
DELETE FROM audit_log;
DELETE FROM patrol_escalation_events;
DELETE FROM patrol_breadcrumbs;
DELETE FROM patrol_members;
DELETE FROM patrols;
DELETE FROM devices;
DELETE FROM login_attempts;
DELETE FROM next_of_kin;
DELETE FROM incidents;
DELETE FROM emergency_services;
DELETE FROM residents;
DELETE FROM vehicles;
DELETE FROM live_pins;
DELETE FROM patrollers;
DELETE FROM sectors;
DELETE FROM cpfs;

INSERT INTO cpfs (id, name, province) VALUES ('${cpfId}', '${esc(org.name)}', '${esc(org.province)}');
INSERT INTO sectors (id, cpf_id, name) VALUES ('${sectorId}', '${cpfId}', '${esc(org.sector)}');
`;

for (const m of data.members) {
  const id = memberIds.get(m.call_sign.toUpperCase());
  const pwd = m.access_level === "admin" ? adminHash : patrolHash;
  const phone = m.phone ? `'${esc(m.phone)}'` : "NULL";
  sql += `INSERT INTO patrollers (id, cpf_id, sector_id, call_sign, name, phone, password_hash, access_level, status) VALUES ('${id}', '${cpfId}', '${sectorId}', '${esc(m.call_sign)}', '${esc(m.name)}', ${phone}, '${esc(pwd)}', '${esc(m.access_level)}', '${esc(m.status || "active")}');\n`;
}

// Couple of known NOKs for demo
const theuns = memberIds.get("WC29");
const adele = memberIds.get("WC46");
if (theuns && adele) {
  sql += `INSERT INTO next_of_kin (patroller_id, name, relationship, phone) VALUES ('${theuns}', 'Adele Barnardt', 'Spouse', '+27 72 222 2222');\n`;
  sql += `INSERT INTO next_of_kin (patroller_id, name, relationship, phone) VALUES ('${adele}', 'Theuns Barnardt', 'Spouse', '+27 72 235 2283');\n`;
}

for (const v of data.vehicles) {
  const id = uuid();
  const assigned = v.assigned_call_sign ? memberIds.get(String(v.assigned_call_sign).toUpperCase()) : null;
  const patrollerCol = assigned ? `'${assigned}'` : "NULL";
  sql += `INSERT INTO vehicles (id, cpf_id, sector_id, patroller_id, registration, description, last_odometer, status) VALUES ('${id}', '${cpfId}', '${sectorId}', ${patrollerCol}, '${esc(v.registration)}', '${esc(v.description || "")}', ${Number(v.last_odometer) || 0}, 'available');\n`;
}

for (const s of data.emergency_services) {
  const secondary = s.secondary_number ? `'${esc(s.secondary_number)}'` : "NULL";
  const verified = s.verified_at ? `'${esc(s.verified_at)}'` : "datetime('now')";
  sql += `INSERT INTO emergency_services (cpf_id, name, service_type, primary_number, secondary_number, priority, sensitive, verified_at) VALUES ('${cpfId}', '${esc(s.name)}', '${esc(s.service_type)}', '${esc(s.primary_number)}', ${secondary}, ${Number(s.priority) || 100}, 0, ${verified});\n`;
}

// Keep a few demo incidents for hotspot UI
const types = ["theft", "burglary", "suspicious_person", "alarm", "traffic_incident"];
const sevs = ["low", "medium", "high"];
for (let i = 0; i < 14; i++) {
  const lat = (-25.842 + (Math.random() - 0.5) * 0.02).toFixed(6);
  const lng = (28.178 + (Math.random() - 0.5) * 0.02).toFixed(6);
  sql += `INSERT INTO incidents (cpf_id, sector_id, type, severity, lat, lng, occurred_at, description) VALUES ('${cpfId}', '${sectorId}', '${types[i % 5]}', '${sevs[i % 3]}', ${lat}, ${lng}, datetime('now', '-${i * 3} hours'), 'Demo incident');\n`;
}

const out = join(__dirname, "_local-seed.sql");
writeFileSync(out, sql);
console.log("Wrote", out);
console.log(`Seeded from cpf.ods: ${data.members.length} members, ${data.vehicles.length} vehicles, ${data.emergency_services.length} emergency services`);
console.log("Passwords: admins → Admin1234!  |  others → Patrol123!");
console.log("Login examples: WV01 / Admin1234!   WC29 / Patrol123!   WV46 / Patrol123!");
