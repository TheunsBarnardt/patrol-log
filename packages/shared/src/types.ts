// Shared TypeScript types for Patrol Log.
// FDL: derived from blueprints/{auth,workflow,data}/*.blueprint.yaml

export type AccessLevel =
  | "call_centre_agent"
  | "patroller"
  | "sector_lead"
  | "admin"
  | "system_admin";
export type PatrolType =
  | "foot"
  | "vehicle"
  | "static"
  | "sector_monitoring"
  | "ops"
  | "responding";

/** Vehicle + odometer required: Vehicle, Monitoring, OPS, Responding. */
export function patrolTypeRequiresVehicle(type: PatrolType): boolean {
  return type === "vehicle" || type === "sector_monitoring" || type === "ops" || type === "responding";
}

export type PatrolState = "active" | "stood_down";
export type PatrolRole = "primary" | "joined";
export type StandDownReason = "shift_end" | "emergency" | "vehicle_issue" | "personal";
export type ServiceType =
  | "police"
  | "ambulance"
  | "fire"
  | "armed_response"
  | "hospital"
  | "ops_room"
  | "vet"
  | "tow"
  | "poison_control"
  | "other";
export type HotspotPeriod = "today" | "7d" | "30d" | "90d";

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy_m: number;
  captured_at: string; // ISO timestamp
}

// ── Auth ────────────────────────────────────────────────────
export interface LoginRequest {
  call_sign: string;
  password: string;
  device_id: string;
}

export interface LoginResponse {
  device_token: string;
  patroller: PatrollerProfile;
}

export interface PatrollerProfile {
  patroller_id: string;
  call_sign: string;
  name: string;
  access_level: AccessLevel;
  organization: string;
  sector: string;
  province: string;
  cpf_id: string;
  sector_id: string;
}

export interface ResumeRequest {
  device_token: string;
  device_id: string;
}

// ── Commence patrol ─────────────────────────────────────────
export interface CommencePatrolRequest {
  joined_patroller_call_signs: string[];
  /** Free-text guest passenger names (non-members). */
  guest_names?: string[];
  patrol_type: PatrolType;
  patrol_vehicle?: string; // required for vehicle / monitoring / ops / responding
  odometer_start?: number; // optional; when set, stand-down asks for end odometer
  start_location?: GeoPoint;
}

export interface ActivePatrolGuest {
  id: string;
  display_name: string;
  note?: string;
  created_at: string;
}

export interface ActivePatrolResponse {
  patrol_id: string;
  primary_patroller_call_sign: string;
  joined_patrollers: JoinedPatroller[];
  guests: ActivePatrolGuest[];
  patrol_type: PatrolType;
  patrol_vehicle?: string;
  odometer_start?: number;
  start_time: string;
  start_location?: GeoPoint;
  sars_compliant: boolean;
  state: PatrolState;
  /** Caller's membership role on this patrol. */
  my_role: PatrolRole;
}

export interface JoinedPatroller {
  call_sign: string;
  name: string;
  start_time: string;
  end_time?: string;
}

export interface AddPatrolGuestRequest {
  display_name: string;
  note?: string;
}

// ── Stand down ──────────────────────────────────────────────
export interface StandDownRequest {
  /** Required for primary on vehicle patrol when odometer_start was set. */
  odometer_end?: number;
  /** Required for primary on vehicle patrol when odometer_start was omitted. */
  distance_km?: number;
  end_location?: GeoPoint;
  reason?: StandDownReason;
  handoff?: {
    new_primary_call_sign: string;
    continue_vehicle: boolean;
    new_vehicle?: string;
  };
}

export interface AddPatrolMembersRequest {
  call_signs: string[];
}

export interface StandDownMemberRequest {
  call_sign: string;
}

/** Active patrols in the caller's sector that they can join as a passenger. */
export interface JoinablePatrolSummary {
  patrol_id: string;
  primary_patroller_call_sign: string;
  primary_patroller_name: string;
  patrol_type: PatrolType;
  vehicle_registration?: string | null;
  start_time: string;
  joined_count: number;
}

export interface StandDownResponse {
  patrol_id: string;
  end_time: string;
  distance_km?: number;
  sars_compliant: boolean;
  record_seal_hash: string;
  handoff?: { new_patrol_id: string; new_primary_call_sign: string };
}

/** Log a completed patrol after the fact (emergency / no time to commence). */
export interface CapturePatrolRequest {
  patrol_type: PatrolType;
  /** ISO start time */
  start_time: string;
  /** ISO end time */
  end_time: string;
  /** Required for vehicle / monitoring / ops / responding; optional otherwise (defaults 0). */
  distance_km?: number;
  patrol_vehicle?: string;
  reason?: StandDownReason;
  guest_names?: string[];
}

export interface CapturePatrolResponse {
  patrol_id: string;
  start_time: string;
  end_time: string;
  distance_km: number;
  patrol_type: PatrolType;
  sars_compliant: boolean;
  record_seal_hash: string;
}

// ── Hotspots ────────────────────────────────────────────────
/** Managed hotspot (admin-defined). Rating 1–5; diameter in km. */
export interface HotspotPin {
  hotspot_id: string;
  title: string;
  description: string;
  rating: number;
  diameter_km: number;
  lat: number;
  lng: number;
  created_at: string;
  sector_id: string;
  /** @deprecated mapped from rating for older clients */
  severity?: "low" | "medium" | "high" | "critical";
  /** @deprecated use hotspot_id */
  incident_id?: string;
  type?: string;
  occurred_at?: string;
}

export interface HotspotsResponse {
  period: HotspotPeriod;
  from: string;
  to: string;
  pins: HotspotPin[];
}

export interface HotspotRecord {
  id: string;
  title: string;
  description: string;
  rating: number;
  diameterKm: number;
  lat: number;
  lng: number;
  sectorId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Directories ─────────────────────────────────────────────
export interface ResidentRecord {
  resident_id: string;
  name: string;
  phone: string;
  address: string;
}

export interface NextOfKinRecord {
  name: string;
  relationship: string;
  phone: string;
  alternate_phone?: string;
}

export interface MemberRecord {
  member_id: string;
  name: string;
  call_sign: string;
  phone: string;
  address: string;
  sector: string;
  access_level: AccessLevel;
  is_on_duty: boolean;
  next_of_kin: NextOfKinRecord[];
}

export interface EmergencyServiceRecord {
  service_id: string;
  name: string;
  service_type: ServiceType;
  primary_number: string;
  secondary_number?: string;
  address?: string;
  priority: number;
  verified_at: string;
  sensitive: boolean;
}

// ── Live map ────────────────────────────────────────────────
export interface HeartbeatRequest {
  patrol_id: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy_m: number;
  timestamp: string;
  signature: string;
  /** Local GPS trail so other patrollers can see this route (grid scan). */
  trail?: Array<{ lat: number; lng: number }>;
}

/** Uber-style map glyph: driving, on foot, or standing still. */
export type LiveMapMovement = "car" | "walk" | "stationary";

export interface LiveMapPin {
  patrol_id: string;
  call_sign: string;
  patrol_type: PatrolType;
  /** Vehicle id when on a vehicle patrol (internal). */
  patrol_vehicle?: string;
  /** Plate / registration for map labels (when known). */
  vehicle_registration?: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number; // m/s
  last_update: string;
  duration_on_patrol_min: number;
  stale: boolean;
  /** Downsampled [lat, lng] trail for this patrol. */
  path?: [number, number][];
  /** Approximate km along `path`. */
  path_km?: number;
}

export type LiveMapMessage =
  | { type: "snapshot"; pins: LiveMapPin[] }
  | { type: "pin_updated"; pin: LiveMapPin }
  | { type: "pin_removed"; patrol_id: string };

export interface VehicleRecord {
  id: string;
  registration: string;
  description: string | null;
  lastOdometer: number;
  status: "available" | "maintenance" | "retired";
  sectorId: string;
  cpfId: string;
}

// ── Live map (extended) ──────────────────────────────────
// out_of_sector added to LiveMapPin for dispatch display
export interface LiveMapPinExtended extends LiveMapPin {
  out_of_sector?: boolean;
}

// ── Heartbeat response ───────────────────────────────────
export interface HeartbeatResponse {
  ok: boolean;
  out_of_sector: boolean;
}

// ── Messaging ────────────────────────────────────────────
export interface MessageChannel {
  id: string;
  type: "broadcast" | "sector" | "direct";
  /** WhatsApp-style: 1:1 chat vs multi-member group */
  kind: "chat" | "group";
  name: string;
  sectorId: string | null;
  memberCount: number;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

export interface MessageChannelMember {
  patrollerId: string;
  callSign: string;
  name: string;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string | null;
  senderCallSign: string;
  body: string;
  priority: "normal" | "urgent";
  createdAt: string;
  isRead: boolean;
}

// ── Admin dashboard analytics ────────────────────────────
export type StatsPeriod = "today" | "7d" | "30d" | "month" | "all" | "custom";

export interface DashboardMemberStats {
  patrollerId: string;
  callSign: string;
  name: string;
  patrolCount: number;
  hours: number;
  km: number;
}

export interface DashboardOverview {
  period: StatsPeriod;
  periodStart: string;
  periodEnd: string;
  patrolType: PatrolType | null;
  sector?: { id: string; code: string | null; name: string } | null;
  kpis: {
    totalKm: number;
    totalHours: number;
    completedPatrols: number;
    activePatrols: number;
    uniqueMembers: number;
  };
  hoursByType: Record<PatrolType, number>;
  kmByDay: { date: string; km: number }[];
  members: DashboardMemberStats[];
}

/** Personal patrol totals for the logged-in patroller (mobile dashboard). */
export interface PatrollerStats {
  period: StatsPeriod;
  periodStart: string;
  totalKm: number;
  totalHours: number;
  completedPatrols: number;
}

// ── Patrol report exports ────────────────────────────────
export interface PatrolReportFilters {
  from: string;
  to: string;
  patrolType?: PatrolType | null;
}

export interface PatrolDetailReportRow {
  callSign: string;
  name: string;
  sector: string;
  /** Primary, joined passenger, or non-member guest. */
  role: "primary" | "joined" | "guest";
  patrolType: PatrolType;
  commencedAt: string;
  stoodDownAt: string | null;
  durationHours: number;
  durationLabel: string;
  /** Always 0 for joined passengers and guests — km credits the primary only. */
  distanceKm: number;
  vehicleRegistration: string | null;
  vehicleDescription: string | null;
}

export interface PatrolDetailReport {
  from: string;
  to: string;
  patrolType: PatrolType | null;
  rows: PatrolDetailReportRow[];
}

export interface PatrolSummaryMemberRow {
  callSign: string;
  name: string;
  totalKm: number;
  totalHours: number;
}

export interface PatrolSummaryReport {
  from: string;
  to: string;
  patrolType: PatrolType | null;
  members: PatrolSummaryMemberRow[];
  topHours: PatrolSummaryMemberRow[];
  topKm: PatrolSummaryMemberRow[];
}
