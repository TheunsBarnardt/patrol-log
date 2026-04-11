// Drizzle ORM schema for Patrol Log.
// Neon serverless Postgres via @neondatabase/serverless.
// FDL: derived from blueprints/{auth,workflow,data}/*.blueprint.yaml

import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// GeoJSON Polygon (coordinates use [lng, lat] order per GeoJSON spec)
export type GeoJSONPolygon = { type: "Polygon"; coordinates: [number, number][][] };

// ── Enums ────────────────────────────────────────────────
export const accessLevelEnum = pgEnum("access_level", [
  "call_centre_agent",
  "patroller",
  "sector_lead",
  "admin",
]);

export const patrollerStatusEnum = pgEnum("patroller_status", ["active", "inactive", "suspended"]);

export const deviceStatusEnum = pgEnum("device_status", ["active", "revoked"]);

export const patrolTypeEnum = pgEnum("patrol_type", ["foot", "vehicle", "static"]);
export const patrolStateEnum = pgEnum("patrol_state", ["active", "stood_down"]);
export const patrolRoleEnum = pgEnum("patrol_role", ["primary", "joined"]);
export const standDownReasonEnum = pgEnum("stand_down_reason", ["shift_end", "emergency", "vehicle_issue", "personal"]);

export const serviceTypeEnum = pgEnum("service_type", [
  "police",
  "ambulance",
  "fire",
  "armed_response",
  "hospital",
  "ops_room",
  "vet",
  "tow",
  "poison_control",
  "other",
]);

export const vehicleStatusEnum = pgEnum("vehicle_status", ["available", "maintenance", "retired"]);

export const messageChannelTypeEnum = pgEnum("message_channel_type", ["broadcast", "sector", "direct"]);
export const messagePriorityEnum = pgEnum("message_priority", ["normal", "urgent"]);

// ── Organisation ─────────────────────────────────────────
export const cpfs = pgTable("cpfs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  province: text("province").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sectors = pgTable("sectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  boundaries: jsonb("boundaries").$type<GeoJSONPolygon | null>().default(null),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cpfIdx: index("sectors_cpf_idx").on(t.cpfId),
}));

// ── Patrollers ───────────────────────────────────────────
export const patrollers = pgTable("patrollers", {
  id: uuid("id").primaryKey().defaultRandom(),
  callSign: text("call_sign").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  passwordHash: text("password_hash").notNull(),
  accessLevel: accessLevelEnum("access_level").notNull().default("patroller"),
  status: patrollerStatusEnum("status").notNull().default("active"),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id),
  sectorId: uuid("sector_id").notNull().references(() => sectors.id),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  callSignCpfIdx: uniqueIndex("patrollers_callsign_cpf_idx").on(t.callSign, t.cpfId),
  sectorIdx: index("patrollers_sector_idx").on(t.sectorId),
}));

export const nextOfKin = pgTable("next_of_kin", {
  id: uuid("id").primaryKey().defaultRandom(),
  patrollerId: uuid("patroller_id").notNull().references(() => patrollers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  alternatePhone: text("alternate_phone"),
}, (t) => ({
  patrollerIdx: index("nok_patroller_idx").on(t.patrollerId),
}));

// ── Devices (WhatsApp-style persistent sessions) ─────────
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  patrollerId: uuid("patroller_id").notNull().references(() => patrollers.id, { onDelete: "cascade" }),
  tokenJti: text("token_jti").notNull(),
  status: deviceStatusEnum("status").notNull().default("active"),
  userAgent: text("user_agent"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patrollerIdx: index("devices_patroller_idx").on(t.patrollerId),
  deviceIdx: uniqueIndex("devices_patroller_device_idx").on(t.patrollerId, t.deviceId),
}));

// ── Login attempts (rate limit + lockout) ───────────────
export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  callSign: text("call_sign").notNull(),
  ip: text("ip"),
  deviceId: text("device_id"),
  outcome: text("outcome").notNull(), // "success" | "invalid_credentials" | "inactive" | "locked" | ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  callSignIdx: index("login_attempts_callsign_idx").on(t.callSign, t.createdAt),
  ipIdx: index("login_attempts_ip_idx").on(t.ip, t.createdAt),
}));

// ── Vehicles ─────────────────────────────────────────────
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: uuid("sector_id").references(() => sectors.id),
  patrollerId: uuid("patroller_id").references(() => patrollers.id, { onDelete: "set null" }),
  registration: text("registration").notNull(),
  description: text("description"),
  lastOdometer: integer("last_odometer").notNull().default(0),
  status: vehicleStatusEnum("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cpfIdx: index("vehicles_cpf_idx").on(t.cpfId),
  regIdx: uniqueIndex("vehicles_reg_cpf_idx").on(t.registration, t.cpfId),
  patrollerIdx: index("vehicles_patroller_idx").on(t.patrollerId),
}));

// ── Patrols ──────────────────────────────────────────────
export const patrols = pgTable("patrols", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id),
  sectorId: uuid("sector_id").notNull().references(() => sectors.id),
  primaryPatrollerId: uuid("primary_patroller_id").notNull().references(() => patrollers.id),
  patrolType: patrolTypeEnum("patrol_type").notNull(),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  odometerStart: integer("odometer_start"),
  odometerEnd: integer("odometer_end"),
  distanceKm: integer("distance_km"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull().defaultNow(),
  endTime: timestamp("end_time", { withTimezone: true }),
  startLat: doublePrecision("start_lat"),
  startLng: doublePrecision("start_lng"),
  startAccuracyM: doublePrecision("start_accuracy_m"),
  endLat: doublePrecision("end_lat"),
  endLng: doublePrecision("end_lng"),
  endAccuracyM: doublePrecision("end_accuracy_m"),
  sarsPurpose: text("sars_purpose").notNull().default("CPF sector patrol"),
  sarsCompliant: boolean("sars_compliant").notNull().default(false),
  state: patrolStateEnum("state").notNull().default("active"),
  reason: standDownReasonEnum("reason"),
  recordSealHash: text("record_seal_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cpfIdx: index("patrols_cpf_idx").on(t.cpfId, t.state),
  sectorActiveIdx: index("patrols_sector_active_idx").on(t.sectorId, t.state),
  primaryIdx: index("patrols_primary_idx").on(t.primaryPatrollerId, t.state),
  vehicleIdx: index("patrols_vehicle_idx").on(t.vehicleId, t.state),
}));

export const patrolMembers = pgTable("patrol_members", {
  patrolId: uuid("patrol_id").notNull().references(() => patrols.id, { onDelete: "cascade" }),
  patrollerId: uuid("patroller_id").notNull().references(() => patrollers.id),
  role: patrolRoleEnum("role").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull().defaultNow(),
  endTime: timestamp("end_time", { withTimezone: true }),
  endLat: doublePrecision("end_lat"),
  endLng: doublePrecision("end_lng"),
}, (t) => ({
  pk: primaryKey({ columns: [t.patrolId, t.patrollerId] }),
  activeByPatrollerIdx: index("patrol_members_active_by_patroller_idx").on(t.patrollerId, t.endTime),
}));

export const patrolBreadcrumbs = pgTable("patrol_breadcrumbs", {
  id: uuid("id").primaryKey().defaultRandom(),
  patrolId: uuid("patrol_id").notNull().references(() => patrols.id, { onDelete: "cascade" }),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  heading: doublePrecision("heading"),
  speed: doublePrecision("speed"),
  accuracyM: doublePrecision("accuracy_m").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patrolIdx: index("breadcrumbs_patrol_idx").on(t.patrolId, t.recordedAt),
}));

export const patrolEscalationEvents = pgTable("patrol_escalation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  patrolId: uuid("patrol_id").notNull().references(() => patrols.id, { onDelete: "cascade" }),
  actorPatrollerId: uuid("actor_patroller_id").notNull().references(() => patrollers.id),
  serviceId: uuid("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  serviceType: serviceTypeEnum("service_type").notNull(),
  calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patrolIdx: index("escalation_patrol_idx").on(t.patrolId),
}));

// ── Live pins (polling cache for POC) ───────────────────
export const livePins = pgTable("live_pins", {
  patrolId: uuid("patrol_id").primaryKey().references(() => patrols.id, { onDelete: "cascade" }),
  cpfId: uuid("cpf_id").notNull(),
  sectorId: uuid("sector_id").notNull(),
  callSign: text("call_sign").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  heading: doublePrecision("heading"),
  speed: doublePrecision("speed"),
  accuracyM: doublePrecision("accuracy_m").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  outOfSector: boolean("out_of_sector").notNull().default(false),
  lastOutOfSectorAlertAt: timestamp("last_out_of_sector_alert_at", { withTimezone: true }),
}, (t) => ({
  cpfSectorIdx: index("live_pins_cpf_sector_idx").on(t.cpfId, t.sectorId),
  lastSeenIdx: index("live_pins_last_seen_idx").on(t.lastSeenAt),
}));

// ── Directories ──────────────────────────────────────────
export const residents = pgTable("residents", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: uuid("sector_id").notNull().references(() => sectors.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sectorIdx: index("residents_sector_idx").on(t.sectorId),
  nameIdx: index("residents_name_idx").on(t.name),
}));

export const emergencyServices = pgTable("emergency_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serviceType: serviceTypeEnum("service_type").notNull(),
  primaryNumber: text("primary_number").notNull(),
  secondaryNumber: text("secondary_number"),
  address: text("address"),
  sectorIds: jsonb("sector_ids").$type<string[]>().default(sql`'[]'::jsonb`),
  priority: integer("priority").notNull().default(100),
  sensitive: boolean("sensitive").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cpfIdx: index("emergency_services_cpf_idx").on(t.cpfId),
}));

// ── Incidents (for hotspots) ─────────────────────────────
export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id, { onDelete: "cascade" }),
  sectorId: uuid("sector_id").references(() => sectors.id),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  occurredIdx: index("incidents_occurred_idx").on(t.occurredAt),
  cpfIdx: index("incidents_cpf_idx").on(t.cpfId),
}));

// ── Audit log (POPIA) ────────────────────────────────────
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorPatrollerId: uuid("actor_patroller_id").references(() => patrollers.id),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  ip: text("ip"),
  deviceId: text("device_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  actorIdx: index("audit_actor_idx").on(t.actorPatrollerId, t.createdAt),
  actionIdx: index("audit_action_idx").on(t.action, t.createdAt),
}));

// ── Push tokens (Expo push notification tokens) ──────────
export const pushTokens = pgTable("push_tokens", {
  patrollerId: uuid("patroller_id").primaryKey().references(() => patrollers.id, { onDelete: "cascade" }),
  expoToken: text("expo_token").notNull(),
  platform: text("platform").notNull(), // 'ios' | 'android'
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Messaging ────────────────────────────────────────────
export const messageChannels = pgTable("message_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  cpfId: uuid("cpf_id").notNull().references(() => cpfs.id, { onDelete: "cascade" }),
  type: messageChannelTypeEnum("type").notNull(),
  name: text("name").notNull(),
  sectorId: uuid("sector_id").references(() => sectors.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cpfIdx: index("msg_channels_cpf_idx").on(t.cpfId),
  sectorIdx: index("msg_channels_sector_idx").on(t.sectorId),
}));

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => messageChannels.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").references(() => patrollers.id, { onDelete: "set null" }),
  senderCallSign: text("sender_call_sign").notNull(),
  body: text("body").notNull(),
  priority: messagePriorityEnum("priority").notNull().default("normal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  channelIdx: index("messages_channel_idx").on(t.channelId, t.createdAt),
}));

export const messageReads = pgTable("message_reads", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  patrollerId: uuid("patroller_id").notNull().references(() => patrollers.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.patrollerId] }),
  patrollerIdx: index("msg_reads_patroller_idx").on(t.patrollerId),
}));

// Members of a direct-message channel (broadcast/sector membership is derived from patroller fields)
export const messageChannelMembers = pgTable("message_channel_members", {
  channelId: uuid("channel_id").notNull().references(() => messageChannels.id, { onDelete: "cascade" }),
  patrollerId: uuid("patroller_id").notNull().references(() => patrollers.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.patrollerId] }),
}));
