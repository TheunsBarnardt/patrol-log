// Thin typed fetch wrapper used by the mobile app and admin portal.
import type {
  ActivePatrolResponse,
  AddPatrolGuestRequest,
  AddPatrolMembersRequest,
  CommencePatrolRequest,
  JoinablePatrolSummary,
  EmergencyServiceRecord,
  HeartbeatRequest,
  HeartbeatResponse,
  HotspotPeriod,
  HotspotsResponse,
  LiveMapPin,
  LoginRequest,
  LoginResponse,
  MemberRecord,
  Message,
  MessageChannel,
  MessageChannelMember,
  PatrollerStats,
  ResidentRecord,
  ResumeRequest,
  StandDownMemberRequest,
  StandDownRequest,
  StandDownResponse,
  StatsPeriod,
  VehicleRecord,
} from "./types";
import type { ErrorCode } from "./errors";

export interface ApiClientOptions {
  /** Static base URL (admin / simple clients). */
  baseUrl?: string;
  /** Prefer this — resolves on every request (mobile web proxy). */
  getBaseUrl?: () => string;
  getDeviceToken?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void;
}

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message || `HTTP ${status}`);
    this.name = "ApiError";
  }
  get code(): ErrorCode { return this.body.error; }
}

/**
 * True only for real session failures.
 * Requires both the right HTTP status and API error code — never treat HTML/502/etc as logout.
 */
function isSessionAuthFailure(status: number, code?: string): boolean {
  if (status === 401 && code === "LOGIN_INVALID_CREDENTIALS") return true;
  if (status === 403 && code === "LOGIN_DEVICE_REVOKED") return true;
  if (status === 403 && code === "LOGIN_ACCOUNT_INACTIVE") return true;
  return false;
}

export function createApiClient(opts: ApiClientOptions) {
  function resolveBase(): string {
    const raw = opts.getBaseUrl?.() ?? opts.baseUrl ?? "";
    return raw.replace(/\/$/, "");
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    const token = opts.getDeviceToken ? await opts.getDeviceToken() : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${resolveBase()}${path}`, { ...init, headers });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // Do NOT invent LOGIN_* codes here — that previously forced logout on HTML 502s etc.
        body = { error: "API_UNAVAILABLE", message: text.slice(0, 160) || `HTTP ${res.status}` };
      }
    }

    if (!res.ok) {
      const errBody = body as ApiErrorBody | null;
      // Only clear session when we actually sent a token and the API rejected it as a session failure.
      if (
        token &&
        opts.onUnauthorized &&
        isSessionAuthFailure(res.status, errBody?.error)
      ) {
        opts.onUnauthorized();
      }
      throw new ApiError(
        res.status,
        (errBody ?? {
          error: "API_UNAVAILABLE",
          message: `HTTP ${res.status}`,
        }) as ApiErrorBody,
      );
    }
    return body as T;
  }

  return {
    // auth
    login: (body: LoginRequest) => request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    resume: (body: ResumeRequest) => request<LoginResponse>("/auth/resume", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
    me: () => request<LoginResponse["patroller"]>("/auth/me"),

    // patrols
    commencePatrol: (body: CommencePatrolRequest) => request<ActivePatrolResponse>("/patrols/commence", { method: "POST", body: JSON.stringify(body) }),
    activePatrol: () => request<ActivePatrolResponse | null>("/patrols/active/me"),
    joinablePatrols: () => request<{ results: JoinablePatrolSummary[] }>("/patrols/active"),
    joinPatrol: (patrolId: string) =>
      request<ActivePatrolResponse>(`/patrols/${patrolId}/join`, { method: "POST", body: JSON.stringify({}) }),
    myPatrolStats: (period: StatsPeriod = "month") =>
      request<PatrollerStats>(`/patrols/stats/me?period=${period}`),
    standDown: (patrolId: string, body: StandDownRequest) => request<StandDownResponse>(`/patrols/${patrolId}/stand-down`, { method: "POST", body: JSON.stringify(body) }),
    standDownMember: (patrolId: string, body: StandDownMemberRequest) =>
      request<ActivePatrolResponse>(`/patrols/${patrolId}/members/stand-down`, { method: "POST", body: JSON.stringify(body) }),
    addPatrolMembers: (patrolId: string, body: AddPatrolMembersRequest) =>
      request<ActivePatrolResponse>(`/patrols/${patrolId}/members`, { method: "POST", body: JSON.stringify(body) }),
    addPatrolGuest: (patrolId: string, body: AddPatrolGuestRequest) =>
      request<ActivePatrolResponse>(`/patrols/${patrolId}/guests`, { method: "POST", body: JSON.stringify(body) }),
    removePatrolGuest: (patrolId: string, guestId: string) =>
      request<ActivePatrolResponse>(`/patrols/${patrolId}/guests/${guestId}`, { method: "DELETE" }),

    // hotspots
    hotspots: (period: HotspotPeriod) => request<HotspotsResponse>(`/hotspots?period=${period}`),

    // directories
    residents: (q?: string) => request<{ results: ResidentRecord[] }>(`/directory/residents${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    members: (q?: string) => request<{ results: MemberRecord[] }>(`/directory/members${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    emergencyContacts: () => request<{ results: EmergencyServiceRecord[] }>("/directory/emergency-contacts"),
    emergencyTapToCall: (serviceId: string) => request<{ ok: true }>(`/directory/emergency-contacts/${serviceId}/call`, { method: "POST" }),
    residentTapToCall: (residentId: string) => request<{ ok: true }>(`/directory/residents/${residentId}/call`, { method: "POST" }),
    memberTapToCall: (memberId: string) => request<{ ok: true }>(`/directory/members/${memberId}/call`, { method: "POST" }),

    // live map (polling mode — POC)
    heartbeat: (body: HeartbeatRequest) => request<HeartbeatResponse>("/live-map/heartbeat", { method: "POST", body: JSON.stringify(body) }),
    liveMapSnapshot: () => request<{ pins: LiveMapPin[] }>("/live-map/snapshot"),

    // vehicles (available to any authenticated patroller)
    vehicles: () => request<{ results: VehicleRecord[] }>("/vehicles"),
    createOwnVehicle: (body: { registration: string; description?: string; last_odometer?: number }) =>
      request<VehicleRecord>("/vehicles", { method: "POST", body: JSON.stringify(body) }),
    updateOwnVehicle: (
      id: string,
      body: { registration?: string; description?: string; last_odometer?: number },
    ) => request<VehicleRecord>(`/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

    // auth extras
    changePassword: (body: { current_password: string; new_password: string }) =>
      request<{ ok: true }>("/auth/change-password", { method: "POST", body: JSON.stringify(body) }),

    // push tokens
    registerPushToken: (body: { expo_token: string; platform: string }) =>
      request<{ ok: true }>("/push-tokens", { method: "POST", body: JSON.stringify(body) }),

    // messaging
    messageChannels: () => request<{ channels: MessageChannel[] }>("/messages"),
    channelMessages: (channelId: string, before?: string) =>
      request<{ messages: Message[] }>(`/messages/${channelId}${before ? `?before=${encodeURIComponent(before)}` : ""}`),
    sendMessage: (channelId: string, body: { body: string; priority?: "normal" | "urgent" }) =>
      request<Message>(`/messages/${channelId}`, { method: "POST", body: JSON.stringify(body) }),
    markChannelRead: (channelId: string) =>
      request<{ ok: true; marked: number }>(`/messages/${channelId}/read`, { method: "POST" }),
    openDirectChannel: (targetPatrollerId: string) =>
      request<{ id: string; type: string; kind: "chat" | "group"; name: string; sectorId: string | null; memberCount: number }>(
        "/messages/direct",
        {
          method: "POST",
          body: JSON.stringify({ target_patroller_id: targetPatrollerId }),
        },
      ),
    createGroup: (body: { name: string; member_ids: string[] }) =>
      request<{ id: string; type: string; kind: "chat" | "group"; name: string; sectorId: string | null; memberCount: number }>(
        "/messages/groups",
        { method: "POST", body: JSON.stringify(body) },
      ),
    channelMembers: (channelId: string) =>
      request<{
        channelId: string;
        kind: "chat" | "group";
        name: string;
        members: MessageChannelMember[];
      }>(`/messages/${channelId}/members`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
