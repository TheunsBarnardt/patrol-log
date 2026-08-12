// Error codes across all 8 blueprints.
// FDL: errors[].code sections of blueprints/**

export const ERROR_CODES = {
  // generic transport / non-JSON failures (never used to force logout)
  API_UNAVAILABLE: { status: 503, message: "Service temporarily unavailable. Please try again." },

  // auth/patroller-login
  LOGIN_INVALID_CREDENTIALS: { status: 401, message: "Invalid call sign or password" },
  LOGIN_MISSING_INPUT: { status: 422, message: "Call sign and password are both required" },
  LOGIN_ACCOUNT_INACTIVE: { status: 403, message: "This account is inactive. Please contact your CPF administrator." },
  LOGIN_ACCOUNT_LOCKED: { status: 423, message: "Account temporarily locked. Please try again later." },
  LOGIN_RATE_LIMITED: { status: 429, message: "Too many login attempts. Please wait a few minutes and try again." },
  LOGIN_DEVICE_REVOKED: { status: 403, message: "This device has been revoked. Please contact your CPF administrator." },

  // workflow/commence-patrol
  COMMENCE_UNAUTHORIZED: { status: 403, message: "Your access level does not permit commencing a patrol" },
  ACCESS_FORBIDDEN: { status: 403, message: "You do not have permission for this action" },
  COMMENCE_INVALID_PATROL_TYPE: { status: 422, message: "Select a valid patrol type (foot, vehicle, static, sector monitoring, OPS, or responding)" },
  COMMENCE_VEHICLE_REQUIRED: { status: 422, message: "Choose a vehicle for this patrol type" },
  COMMENCE_ALREADY_ON_PATROL: { status: 409, message: "You are already on an active patrol" },
  COMMENCE_INVALID_VEHICLE: { status: 422, message: "Selected vehicle is not available for your sector" },
  COMMENCE_VEHICLE_IN_USE: { status: 409, message: "This vehicle is already on another active patrol" },
  COMMENCE_ODOMETER_START_INVALID: { status: 422, message: "Enter a valid odometer reading at or above the last recorded value" },
  COMMENCE_JOINED_PATROLLER_UNAVAILABLE: { status: 409, message: "One or more joined patrollers are unavailable" },
  JOIN_PATROL_UNAVAILABLE: { status: 409, message: "That patrol is not available to join" },
  JOIN_PATROL_ALREADY_MEMBER: { status: 409, message: "You are already on this patrol" },

  // workflow/capture-patrol (log after the fact)
  CAPTURE_INVALID_TIMES: { status: 422, message: "Enter a valid start and end time (end after start, not in the future)" },
  CAPTURE_TOO_OLD: { status: 422, message: "Captured patrols can only be logged for the last 7 days" },
  CAPTURE_DISTANCE_REQUIRED: { status: 422, message: "Enter kilometres travelled for this patrol" },
  CAPTURE_VEHICLE_REQUIRED: { status: 422, message: "Choose a vehicle for this patrol type" },
  CAPTURE_INVALID_VEHICLE: { status: 422, message: "Selected vehicle is not available for your sector" },
  CAPTURE_ALREADY_ON_PATROL: { status: 409, message: "Stand down your active patrol before capturing a past one" },

  // vehicles
  VEHICLE_REGISTRATION_REQUIRED: { status: 422, message: "Enter the vehicle registration" },
  VEHICLE_DUPLICATE_REGISTRATION: { status: 409, message: "That registration is already registered to another patroller" },

  // workflow/stand-down-patrol
  STAND_DOWN_NOT_ON_PATROL: { status: 409, message: "You are not on any active patrol" },
  STAND_DOWN_ALREADY_STOOD_DOWN: { status: 409, message: "Stand down already recorded" },
  STAND_DOWN_ODOMETER_END_REQUIRED: { status: 422, message: "Enter the odometer reading before standing down" },
  STAND_DOWN_DISTANCE_REQUIRED: { status: 422, message: "Enter kilometres travelled before standing down" },
  STAND_DOWN_ODOMETER_END_LESS_THAN_START: { status: 422, message: "End odometer must be greater than the starting odometer" },
  STAND_DOWN_HANDOFF_NO_CANDIDATES: { status: 409, message: "No joined patrollers remain to take over" },
  STAND_DOWN_HANDOFF_NEW_PRIMARY_INVALID: { status: 422, message: "The nominated new primary is not eligible" },
  STAND_DOWN_UNAUTHORIZED: { status: 403, message: "You do not have permission to stand down another patroller" },
  STAND_DOWN_MEMBER_NOT_FOUND: { status: 404, message: "That passenger is not on this patrol" },
  PATROL_GUEST_NAME_REQUIRED: { status: 422, message: "Enter a guest name" },
  PATROL_GUEST_NOT_FOUND: { status: 404, message: "That guest is not on this patrol" },
  PATROL_GUEST_UNAUTHORIZED: { status: 403, message: "Only the primary can manage guests" },
  PATROL_NOT_FOUND: { status: 404, message: "Patrol not found" },
  VEHICLE_NOT_FOUND: { status: 404, message: "Vehicle not found" },
  VEHICLE_FORBIDDEN: { status: 403, message: "You can only edit your own vehicles" },
  PATROL_INVALID_INPUT: { status: 422, message: "Check patrol type, times, odometer, and state" },
  SECTOR_NOT_FOUND: { status: 404, message: "Sector not found" },
  SECTOR_INVALID_INPUT: { status: 422, message: "Enter a sector name (and optional code e.g. WBS4)" },
  SECTOR_DUPLICATE_CODE: { status: 409, message: "That sector code is already in use" },
  SECTOR_HAS_MEMBERS: { status: 409, message: "Move or reassign members before deleting this sector" },

  // data/hotspots-map
  HOTSPOTS_UNAUTHENTICATED: { status: 401, message: "Please log in to view hotspots" },
  HOTSPOTS_INVALID_PERIOD: { status: 422, message: "Select a valid time period" },
  HOTSPOTS_INCIDENTS_API_UNAVAILABLE: { status: 503, message: "Incident data is unavailable. Please try again shortly." },
  HOTSPOTS_MAP_PROVIDER_UNAVAILABLE: { status: 503, message: "Map provider unavailable" },
  HOTSPOTS_NOT_FOUND: { status: 404, message: "Hotspot not found" },
  HOTSPOTS_INVALID_INPUT: { status: 422, message: "Check title, rating (1–5), diameter (km), and location" },

  // data/residents-directory
  RESIDENTS_UNAUTHORIZED: { status: 401, message: "Please log in to view residents" },
  RESIDENTS_RATE_LIMITED: { status: 429, message: "Too many searches. Please wait a moment." },
  RESIDENTS_SEARCH_TERM_TOO_SHORT: { status: 422, message: "Search term must be at least 2 characters" },
  RESIDENTS_SYNC_UNAVAILABLE: { status: 503, message: "Directory temporarily unavailable" },
  RESIDENTS_NO_RESULTS: { status: 404, message: "No residents found" },

  // data/members-directory
  MEMBERS_UNAUTHORIZED: { status: 401, message: "Please log in to view members" },
  MEMBERS_RATE_LIMITED: { status: 429, message: "Too many searches. Please wait a moment." },
  MEMBERS_SEARCH_TERM_TOO_SHORT: { status: 422, message: "Search term must be at least 2 characters" },
  MEMBERS_NO_RESULTS: { status: 404, message: "No members found" },
  MEMBERS_DUPLICATE_CALL_SIGN: { status: 409, message: "That call sign is already in use" },
  MEMBERS_INVALID_CALL_SIGN: { status: 422, message: "Enter a valid call sign (at least 2 characters)" },

  // data/emergency-contacts-directory
  EMERGENCY_UNAUTHORIZED: { status: 401, message: "Please log in" },
  EMERGENCY_NO_SERVICES_CONFIGURED: { status: 404, message: "No emergency contacts configured" },
  EMERGENCY_SYNC_UNAVAILABLE: { status: 503, message: "Emergency contacts unavailable. Use your phone's native 10111." },
  EMERGENCY_SERVICE_NUMBER_UNVERIFIED: { status: 410, message: "This number has not been verified recently" },

  // data/live-patroller-map
  LIVE_MAP_UNAUTHORIZED: { status: 403, message: "Live map is only available to active patrollers and dispatch" },
  LIVE_MAP_HEARTBEAT_RATE_LIMITED: { status: 429, message: "Heartbeat rate limited" },
  // 403 (not 401): invalid signature must NOT force client logout / re-login
  LIVE_MAP_HEARTBEAT_INVALID_SIGNATURE: { status: 403, message: "Heartbeat signature is invalid" },
  LIVE_MAP_HEARTBEAT_PATROL_NOT_ACTIVE: { status: 409, message: "Patrol is not in active state" },
  LIVE_MAP_REALTIME_CHANNEL_DOWN: { status: 503, message: "Realtime channel unavailable. Falling back to polling." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  constructor(public code: ErrorCode, public details?: unknown) {
    super(ERROR_CODES[code].message);
    this.name = "AppError";
  }
  get status() { return ERROR_CODES[this.code].status; }
  get body() { return { error: this.code, message: ERROR_CODES[this.code].message, details: this.details }; }
}
