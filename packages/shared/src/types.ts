// Shared TypeScript types for Patrol Log.
// FDL: derived from blueprints/{auth,workflow,data}/*.blueprint.yaml

export type AccessLevel = "call_centre_agent" | "patroller" | "sector_lead" | "admin";
export type PatrolType = "foot" | "vehicle" | "static";
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
  patrol_type: PatrolType;
  patrol_vehicle?: string; // required when patrol_type === "vehicle"
  odometer_start?: number; // required when patrol_vehicle present
  start_location?: GeoPoint;
}

export interface ActivePatrolResponse {
  patrol_id: string;
  primary_patroller_call_sign: string;
  joined_patrollers: JoinedPatroller[];
  patrol_type: PatrolType;
  patrol_vehicle?: string;
  odometer_start?: number;
  start_time: string;
  start_location?: GeoPoint;
  sars_compliant: boolean;
  state: PatrolState;
}

export interface JoinedPatroller {
  call_sign: string;
  name: string;
  start_time: string;
  end_time?: string;
}

// ── Stand down ──────────────────────────────────────────────
export interface StandDownRequest {
  odometer_end?: number;
  end_location?: GeoPoint;
  reason?: StandDownReason;
  handoff?: {
    new_primary_call_sign: string;
    continue_vehicle: boolean;
    new_vehicle?: string;
  };
}

export interface StandDownResponse {
  patrol_id: string;
  end_time: string;
  distance_km?: number;
  sars_compliant: boolean;
  record_seal_hash: string;
  handoff?: { new_patrol_id: string; new_primary_call_sign: string };
}

// ── Hotspots ────────────────────────────────────────────────
export interface HotspotPin {
  incident_id: string;
  lat: number;
  lng: number;
  type: string;
  severity: "low" | "medium" | "high";
  occurred_at: string;
}

export interface HotspotsResponse {
  period: HotspotPeriod;
  from: string;
  to: string;
  pins: HotspotPin[];
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
}

export interface LiveMapPin {
  patrol_id: string;
  call_sign: string;
  patrol_type: PatrolType;
  patrol_vehicle?: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  last_update: string;
  duration_on_patrol_min: number;
  stale: boolean;
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
  name: string;
  sectorId: string | null;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
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
