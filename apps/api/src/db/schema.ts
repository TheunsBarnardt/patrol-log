// Drizzle ORM schema for Patrol Log — SQLite / Cloudflare D1 compatible.
// FDL: derived from blueprints/{auth,workflow,data}/*.blueprint.yaml

import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
  unique,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// GeoJSON Polygon stored as TEXT (SQLite stores JSON as text)
// coordinates use [lng, lat] order per GeoJSON spec
export type GeoJSONPolygon = { type: "Polygon"; coordinates: [number, number][][] };

// ── Tables ────────────────────────────────────────────────

// ── Organisation ─────────────────────────────────────────
export const cpfs = sqliteTable("cpfs", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  name: text("name").notNull(),
  province: text("province").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
  /** When false, mobile apps cannot see live pins. Admin live map is unchanged. */
  mobileLiveMapEnabled: integer("mobile_live_map_enabled", { mode: "boolean" }).notNull().default(true),
});

export const sectors = sqliteTable("sectors", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Short tenant code e.g. WBS1 / WBS2 / WBS3 */
  code: text("code"),
  /** Legacy column — unused (boundary drawing removed). Kept for D1 compatibility. */
  boundaries: text("boundaries", { mode: "json" }).$type<GeoJSONPolygon | null>().default(null),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("sectors_cpf_idx").on(t.cpfId),
  codeCpfIdx: uniqueIndex("sectors_code_cpf_idx").on(t.cpfId, t.code),
}));

// ── Patrollers ───────────────────────────────────────────
export const patrollers = sqliteTable("patrollers", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  callSign: text("call_sign").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  passwordHash: text("password_hash").notNull(),
  accessLevel: text("access_level")
    .notNull()
    .default("patroller")
    .$type<"call_centre_agent" | "patroller" | "sector_lead" | "admin" | "system_admin">(),
  status: text("status")
    .notNull()
    .default("active")
    .$type<"active" | "inactive" | "suspended">(),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id),
  sectorId: text("sector_id")
    .notNull()
    .references(() => sectors.id),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  // SQLite stores timestamps as TEXT (ISO-8601). Use text() without date mode.
  lockedUntil: text("locked_until"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  callSignCpfIdx: uniqueIndex("patrollers_callsign_cpf_idx").on(t.callSign, t.cpfId),
  sectorIdx: index("patrollers_sector_idx").on(t.sectorId),
}));

export const nextOfKin = sqliteTable("next_of_kin", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  patrollerId: text("patroller_id")
    .notNull()
    .references(() => patrollers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  alternatePhone: text("alternate_phone"),
}, (t) => ({
  patrollerIdx: index("nok_patroller_idx").on(t.patrollerId),
}));

// ── Devices (WhatsApp-style persistent sessions) ─────────
export const devices = sqliteTable("devices", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  deviceId: text("device_id").notNull(),
  patrollerId: text("patroller_id")
    .notNull()
    .references(() => patrollers.id, { onDelete: "cascade" }),
  tokenJti: text("token_jti").notNull(),
  status: text("status")
    .notNull()
    .default("active")
    .$type<"active" | "revoked">(),
  userAgent: text("user_agent"),
  lastSeenAt: text("last_seen_at")
    .notNull()
    .default(sql`datetime('now')`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  patrollerIdx: index("devices_patroller_idx").on(t.patrollerId),
  patrollerDeviceUnique: unique("devices_patroller_device_idx").on(t.patrollerId, t.deviceId),
}));

// ── Login attempts (rate limit + lockout) ───────────────
export const loginAttempts = sqliteTable("login_attempts", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  callSign: text("call_sign").notNull(),
  ip: text("ip"),
  deviceId: text("device_id"),
  outcome: text("outcome").notNull(), // "success" | "invalid_credentials" | "inactive" | "locked" | ...
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  callSignIdx: index("login_attempts_callsign_idx").on(t.callSign, t.createdAt),
  ipIdx: index("login_attempts_ip_idx").on(t.ip, t.createdAt),
}));

// ── Vehicles ─────────────────────────────────────────────
export const vehicles = sqliteTable("vehicles", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: text("sector_id").references(() => sectors.id),
  patrollerId: text("patroller_id").references(() => patrollers.id, { onDelete: "set null" }),
  registration: text("registration").notNull(),
  description: text("description"),
  lastOdometer: integer("last_odometer").notNull().default(0),
  status: text("status")
    .notNull()
    .default("available")
    .$type<"available" | "maintenance" | "retired">(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("vehicles_cpf_idx").on(t.cpfId),
  regIdx: uniqueIndex("vehicles_reg_cpf_idx").on(t.registration, t.cpfId),
  patrollerIdx: index("vehicles_patroller_idx").on(t.patrollerId),
}));

// ── Patrols ──────────────────────────────────────────────
export const patrols = sqliteTable("patrols", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id),
  sectorId: text("sector_id")
    .notNull()
    .references(() => sectors.id),
  primaryPatrollerId: text("primary_patroller_id")
    .notNull()
    .references(() => patrollers.id),
  patrolType: text("patrol_type")
    .notNull()
    .$type<"foot" | "vehicle" | "static" | "sector_monitoring" | "ops" | "responding">(),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  odometerStart: integer("odometer_start"),
  odometerEnd: integer("odometer_end"),
  distanceKm: integer("distance_km"),
  startTime: text("start_time")
    .notNull()
    .default(sql`datetime('now')`),
  endTime: text("end_time"),
  startLat: real("start_lat"),
  startLng: real("start_lng"),
  startAccuracyM: real("start_accuracy_m"),
  endLat: real("end_lat"),
  endLng: real("end_lng"),
  endAccuracyM: real("end_accuracy_m"),
  sarsPurpose: text("sars_purpose").notNull().default("CPF sector patrol"),
  sarsCompliant: integer("sars_compliant", { mode: "boolean" }).notNull().default(false),
  state: text("state")
    .notNull()
    .default("active")
    .$type<"active" | "stood_down">(),
  reason: text("reason").$type<"shift_end" | "emergency" | "vehicle_issue" | "personal">(),
  recordSealHash: text("record_seal_hash"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfStateIdx: index("patrols_cpf_state_idx").on(t.cpfId, t.state),
  sectorActiveIdx: index("patrols_sector_active_idx").on(t.sectorId, t.state),
  primaryIdx: index("patrols_primary_idx").on(t.primaryPatrollerId, t.state),
  vehicleIdx: index("patrols_vehicle_idx").on(t.vehicleId, t.state),
}));

export const patrolMembers = sqliteTable("patrol_members", {
  patrolId: text("patrol_id")
    .notNull()
    .references(() => patrols.id, { onDelete: "cascade" }),
  patrollerId: text("patroller_id")
    .notNull()
    .references(() => patrollers.id),
  role: text("role")
    .notNull()
    .$type<"primary" | "joined">(),
  startTime: text("start_time")
    .notNull()
    .default(sql`datetime('now')`),
  endTime: text("end_time"),
  endLat: real("end_lat"),
  endLng: real("end_lng"),
}, (t) => ({
  pk: primaryKey({ columns: [t.patrolId, t.patrollerId] }),
  activeByPatrollerIdx: index("patrol_members_active_by_patroller_idx").on(t.patrollerId, t.endTime),
}));

/** Non-member guests logged on a patrol (no patroller account). */
export const patrolGuests = sqliteTable("patrol_guests", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  patrolId: text("patrol_id")
    .notNull()
    .references(() => patrols.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  note: text("note"),
  addedByPatrollerId: text("added_by_patroller_id")
    .notNull()
    .references(() => patrollers.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  patrolIdx: index("patrol_guests_patrol_idx").on(t.patrolId),
}));

export const patrolBreadcrumbs = sqliteTable("patrol_breadcrumbs", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  patrolId: text("patrol_id")
    .notNull()
    .references(() => patrols.id, { onDelete: "cascade" }),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  heading: real("heading"),
  speed: real("speed"),
  accuracyM: real("accuracy_m").notNull(),
  recordedAt: text("recorded_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  patrolIdx: index("breadcrumbs_patrol_idx").on(t.patrolId, t.recordedAt),
}));

export const patrolEscalationEvents = sqliteTable("patrol_escalation_events", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  patrolId: text("patrol_id")
    .notNull()
    .references(() => patrols.id, { onDelete: "cascade" }),
  actorPatrollerId: text("actor_patroller_id")
    .notNull()
    .references(() => patrollers.id),
  serviceId: text("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  serviceType: text("service_type")
    .notNull()
    .$type<"police" | "ambulance" | "fire" | "armed_response" | "hospital" | "ops_room" | "vet" | "tow" | "poison_control" | "other">(),
  calledAt: text("called_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  patrolIdx: index("escalation_patrol_idx").on(t.patrolId),
}));

// ── Live pins (polling cache for POC) ───────────────────
export const livePins = sqliteTable("live_pins", {
  patrolId: text("patrol_id")
    .primaryKey()
    .references(() => patrols.id, { onDelete: "cascade" }),
  cpfId: text("cpf_id").notNull(),
  sectorId: text("sector_id").notNull(),
  callSign: text("call_sign").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  heading: real("heading"),
  speed: real("speed"),
  accuracyM: real("accuracy_m").notNull(),
  lastSeenAt: text("last_seen_at")
    .notNull()
    .default(sql`datetime('now')`),
  outOfSector: integer("out_of_sector", { mode: "boolean" }).notNull().default(false),
  lastOutOfSectorAlertAt: text("last_out_of_sector_alert_at"),
  /** Downsampled [lat, lng][] trail for this active patrol (cleared on stand-down with the pin). */
  pathJson: text("path_json", { mode: "json" }).$type<[number, number][]>().notNull().default(sql`'[]'`),
}, (t) => ({
  cpfSectorIdx: index("live_pins_cpf_sector_idx").on(t.cpfId, t.sectorId),
  lastSeenIdx: index("live_pins_last_seen_idx").on(t.lastSeenAt),
}));

// ── Directories ──────────────────────────────────────────
export const residents = sqliteTable("residents", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: text("sector_id")
    .notNull()
    .references(() => sectors.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  sectorIdx: index("residents_sector_idx").on(t.sectorId),
  nameIdx: index("residents_name_idx").on(t.name),
}));

export const emergencyServices = sqliteTable("emergency_services", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serviceType: text("service_type")
    .notNull()
    .$type<"police" | "ambulance" | "fire" | "armed_response" | "hospital" | "ops_room" | "vet" | "tow" | "poison_control" | "other">(),
  primaryNumber: text("primary_number").notNull(),
  secondaryNumber: text("secondary_number"),
  address: text("address"),
  // Store JSON array as TEXT
  sectorIds: text("sector_ids", { mode: "json" })
    .$type<string[]>()
    .default(sql`'[]'`),
  priority: integer("priority").notNull().default(100),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
  verifiedAt: text("verified_at")
    .notNull()
    .default(sql`datetime('now')`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("emergency_services_cpf_idx").on(t.cpfId),
}));

// ── Managed hotspots (admin-defined risk areas) ──────────
export const hotspots = sqliteTable("hotspots", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: text("sector_id")
    .notNull()
    .references(() => sectors.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  /** Risk rating 1 (low) – 5 (critical) */
  rating: integer("rating").notNull().default(3),
  /** Circle diameter in kilometres */
  diameterKm: real("diameter_km").notNull().default(0.5),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("hotspots_cpf_idx").on(t.cpfId),
  sectorIdx: index("hotspots_sector_idx").on(t.sectorId),
}));

// ── Incidents (legacy / seed demo pins) ──────────────────
export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: text("sector_id").references(() => sectors.id),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  occurredAt: text("occurred_at").notNull(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  occurredIdx: index("incidents_occurred_idx").on(t.occurredAt),
  cpfIdx: index("incidents_cpf_idx").on(t.cpfId),
}));

// ── Occurrence book (OB-BOOK-SPEC-001 v1.3) ──────────────
export const obSuburbs = sqliteTable("ob_suburbs", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("ob_suburbs_cpf_idx").on(t.cpfId),
  nameIdx: uniqueIndex("ob_suburbs_name_idx").on(t.cpfId, t.name),
}));

export const obSecurityCompanies = sqliteTable("ob_security_companies", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("ob_security_cpf_idx").on(t.cpfId),
  nameIdx: uniqueIndex("ob_security_name_idx").on(t.cpfId, t.name),
}));

/** Per-sector sequence, restarted each calendar year. */
export const obSequences = sqliteTable("ob_sequences", {
  sectorId: text("sector_id")
    .notNull()
    .references(() => sectors.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastSeq: integer("last_seq").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.sectorId, t.year] }),
}));

export const obEntries = sqliteTable("ob_entries", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: text("sector_id")
    .notNull()
    .references(() => sectors.id),
  obNumber: text("ob_number").notNull(),
  sequence: integer("sequence").notNull(),
  year: integer("year").notNull(),
  status: text("status")
    .notNull()
    .default("active")
    .$type<"active" | "closed">(),
  category: text("category")
    .notNull()
    .$type<"criminal" | "emergency" | "of_interest" | "other">(),
  phase: text("phase").$type<"alpha" | "bravo" | null>(),
  dangerLevel: text("danger_level").$type<"leave_to_police" | "caution" | "respond" | "no_response" | null>(),
  /** Wall-clock SAST the operator typed: YYYY-MM-DD HH:MM:SS */
  occurredAt: text("occurred_at").notNull(),
  timeOfDay: text("time_of_day").notNull(),
  dayOfWeek: text("day_of_week").notNull(),
  suburbId: text("suburb_id").references(() => obSuburbs.id),
  street: text("street").notNull().default(""),
  lat: real("lat"),
  lng: real("lng"),
  description: text("description").notNull().default(""),
  actionDetails: text("action_details").notNull().default(""),
  receivedFrom: text("received_from", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  attendance: text("attendance").$type<"present" | "assisting" | "not_present" | null>(),
  conclusion: text("conclusion"),
  closedAt: text("closed_at"),
  closedById: text("closed_by_id").references(() => patrollers.id, { onDelete: "set null" }),
  capturedById: text("captured_by_id").references(() => patrollers.id, { onDelete: "set null" }),
  callSign: text("call_sign").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  numberIdx: uniqueIndex("ob_entries_number_idx").on(t.cpfId, t.obNumber),
  sectorStatusIdx: index("ob_entries_sector_status_idx").on(t.sectorId, t.status),
  occurredIdx: index("ob_entries_occurred_idx").on(t.cpfId, t.occurredAt),
}));

export const obEntryTypes = sqliteTable("ob_entry_types", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  typeKey: text("type_key").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => ({
  entryIdx: index("ob_entry_types_entry_idx").on(t.entryId),
}));

export const obEntryServices = sqliteTable("ob_entry_services", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  serviceKey: text("service_key").notNull(),
  securityCompanyId: text("security_company_id").references(() => obSecurityCompanies.id, { onDelete: "set null" }),
  reference: text("reference"),
  otherName: text("other_name"),
}, (t) => ({
  entryIdx: index("ob_entry_services_entry_idx").on(t.entryId),
}));

export const obEntryResponders = sqliteTable("ob_entry_responders", {
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  patrollerId: text("patroller_id")
    .notNull()
    .references(() => patrollers.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.entryId, t.patrollerId] }),
}));

/** Patrols that attended an incident. Several can be on one scene. */
export const obEntryPatrols = sqliteTable("ob_entry_patrols", {
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  patrolId: text("patrol_id")
    .notNull()
    .references(() => patrols.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.entryId, t.patrolId] }),
}));

export const obEntryTags = sqliteTable("ob_entry_tags", {
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  tagKey: text("tag_key").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.entryId, t.tagKey] }),
}));

export const obVehicles = sqliteTable("ob_vehicles", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  colour: text("colour"),
  shape: text("shape"),
  make: text("make"),
  model: text("model"),
  registration: text("registration"),
  features: text("features"),
}, (t) => ({
  entryIdx: index("ob_vehicles_entry_idx").on(t.entryId),
  regIdx: index("ob_vehicles_reg_idx").on(t.registration),
}));

export const obPersons = sqliteTable("ob_persons", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().$type<"poi" | "patient">(),
  gender: text("gender"),
  clothing: text("clothing"),
  direction: text("direction"),
  injuryTag: text("injury_tag"),
  note: text("note"),
}, (t) => ({
  entryIdx: index("ob_persons_entry_idx").on(t.entryId),
}));

/** Later “seen here” updates. The latest row is last-seen for BOLOs. */
export const obSightings = sqliteTable("ob_sightings", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  entryId: text("entry_id")
    .notNull()
    .references(() => obEntries.id, { onDelete: "cascade" }),
  suburbId: text("suburb_id").references(() => obSuburbs.id),
  street: text("street").notNull().default(""),
  seenAt: text("seen_at").notNull(),
  note: text("note"),
  reportedById: text("reported_by_id").references(() => patrollers.id, { onDelete: "set null" }),
  callSign: text("call_sign").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  entryIdx: index("ob_sightings_entry_idx").on(t.entryId, t.seenAt),
}));

// ── Audit log (POPIA) ────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  actorPatrollerId: text("actor_patroller_id").references(() => patrollers.id),
  action: text("action").notNull(),
  // Store JSON payload as TEXT
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  ip: text("ip"),
  deviceId: text("device_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  actorIdx: index("audit_actor_idx").on(t.actorPatrollerId, t.createdAt),
  actionIdx: index("audit_action_idx").on(t.action, t.createdAt),
}));

// ── Push tokens (stored for potential future use, but push is disabled) ──
export const pushTokens = sqliteTable("push_tokens", {
  patrollerId: text("patroller_id")
    .primaryKey()
    .references(() => patrollers.id, { onDelete: "cascade" }),
  expoToken: text("expo_token").notNull(),
  platform: text("platform").notNull(), // 'ios' | 'android'
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`datetime('now')`),
});

// ── Messaging ────────────────────────────────────────────
export const messageChannels = sqliteTable("message_channels", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  cpfId: text("cpf_id")
    .notNull()
    .references(() => cpfs.id, { onDelete: "cascade" }),
  type: text("type")
    .notNull()
    .$type<"broadcast" | "sector" | "direct">(),
  name: text("name").notNull(),
  sectorId: text("sector_id").references(() => sectors.id, { onDelete: "set null" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  cpfIdx: index("msg_channels_cpf_idx").on(t.cpfId),
  sectorIdx: index("msg_channels_sector_idx").on(t.sectorId),
}));

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  channelId: text("channel_id")
    .notNull()
    .references(() => messageChannels.id, { onDelete: "cascade" }),
  senderId: text("sender_id").references(() => patrollers.id, { onDelete: "set null" }),
  senderCallSign: text("sender_call_sign").notNull(),
  body: text("body").notNull(),
  priority: text("priority")
    .notNull()
    .default("normal")
    .$type<"normal" | "urgent">(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  channelIdx: index("messages_channel_idx").on(t.channelId, t.createdAt),
}));

export const messageReads = sqliteTable("message_reads", {
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  patrollerId: text("patroller_id")
    .notNull()
    .references(() => patrollers.id, { onDelete: "cascade" }),
  readAt: text("read_at")
    .notNull()
    .default(sql`datetime('now')`),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.patrollerId] }),
  patrollerIdx: index("msg_reads_patroller_idx").on(t.patrollerId),
}));

// Members of a direct-message channel
export const messageChannelMembers = sqliteTable("message_channel_members", {
  channelId: text("channel_id")
    .notNull()
    .references(() => messageChannels.id, { onDelete: "cascade" }),
  patrollerId: text("patroller_id")
    .notNull()
    .references(() => patrollers.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.patrollerId] }),
}));

/**
 * System backups — NEVER wiped by seed scripts.
 * Seed and demo resets must leave this table untouched.
 */
export const systemBackups = sqliteTable("system_backups", {
  id: text("id").primaryKey().default(sql`lower(hex(randomblob(16)))`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`datetime('now')`),
  createdByCallSign: text("created_by_call_sign").notNull(),
  createdByPatrollerId: text("created_by_patroller_id"),
  label: text("label"),
  byteSize: integer("byte_size").notNull().default(0),
  tableCounts: text("table_counts", { mode: "json" }).$type<Record<string, number>>(),
  /** Full JSON backup payload. Seed must never DELETE this table. */
  payload: text("payload").notNull(),
}, (t) => ({
  createdIdx: index("system_backups_created_idx").on(t.createdAt),
}));
