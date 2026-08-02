// Thin typed fetch wrapper used by the mobile app and admin portal.
import type {
  ActivePatrolResponse,
  CommencePatrolRequest,
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
  ResidentRecord,
  ResumeRequest,
  StandDownRequest,
  StandDownResponse,
  VehicleRecord,
} from "./types";
import type { ErrorCode } from "./errors";

export interface ApiClientOptions {
  baseUrl: string;
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

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    const token = opts.getDeviceToken ? await opts.getDeviceToken() : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;

    if (!res.ok) {
      if (res.status === 401 && opts.onUnauthorized) opts.onUnauthorized();
      throw new ApiError(res.status, body as ApiErrorBody);
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
    standDown: (patrolId: string, body: StandDownRequest) => request<StandDownResponse>(`/patrols/${patrolId}/stand-down`, { method: "POST", body: JSON.stringify(body) }),

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
