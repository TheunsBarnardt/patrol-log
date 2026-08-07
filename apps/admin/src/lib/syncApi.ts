/** Cross-environment API helpers for system_admin D1 sync (Cloudflare ↔ local). */

const DEFAULT_REMOTE = "https://patrol-log-api.small-night-657e.workers.dev";
const DEFAULT_LOCAL = "http://localhost:8787";

export function defaultOtherBase(currentBase: string): string {
  const cur = currentBase.replace(/\/$/, "");
  if (cur.includes("localhost") || cur.includes("127.0.0.1")) return DEFAULT_REMOTE;
  return DEFAULT_LOCAL;
}

async function fetchJson<T>(base: string, path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status} on ${path}`);
  }
  return body as T;
}

export async function loginSystemAdmin(
  base: string,
  callSign: string,
  password: string,
): Promise<{ token: string; accessLevel: string; env: string }> {
  const deviceId = `sync-${crypto.randomUUID()}`;
  const login = await fetchJson<{
    device_token: string;
    patroller: { access_level: string };
  }>(base, "/auth/login", {
    method: "POST",
    body: JSON.stringify({
      call_sign: callSign.trim().toUpperCase(),
      password,
      device_id: deviceId,
    }),
  });
  if (login.patroller.access_level !== "system_admin") {
    throw new Error("Only system_admin can sync databases");
  }
  const health = await fetchJson<{ env?: string }>(base, "/health");
  return {
    token: login.device_token,
    accessLevel: login.patroller.access_level,
    env: health.env ?? "unknown",
  };
}

export async function createBackupOn(
  base: string,
  token: string,
  label?: string,
): Promise<{ payload: unknown; env: string }> {
  const res = await fetchJson<{ payload: unknown }>(base, "/admin/system/backup", {
    method: "POST",
    token,
    body: JSON.stringify({ label: label ?? `sync-${new Date().toISOString()}` }),
  });
  const health = await fetchJson<{ env?: string }>(base, "/health");
  return { payload: res.payload, env: health.env ?? "unknown" };
}

export async function restoreOn(
  base: string,
  token: string,
  payload: unknown,
  source: string,
): Promise<void> {
  const health = await fetchJson<{ env?: string }>(base, "/health");
  const isProd = (health.env ?? "").toLowerCase() === "production";
  await fetchJson(base, "/admin/system/restore", {
    method: "POST",
    token,
    body: JSON.stringify({
      payload,
      confirm: isProd ? "RESTORE_PRODUCTION" : "RESTORE",
      source,
    }),
  });
}

export { DEFAULT_REMOTE, DEFAULT_LOCAL };
