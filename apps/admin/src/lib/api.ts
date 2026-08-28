import { createApiClient } from "@patrol-log/shared";

/**
 * Always same-origin `/api` (Pages Function proxy). Do not read VITE_API_BASE_URL —
 * Vite inlines it at build time and `.env.production` was pointing at workers.dev,
 * which SA mobile networks time out on.
 */
export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8787";
    }
    return `${window.location.origin}/api`;
  }
  return "/api";
}

const TOKEN_KEY = "patrol_log.admin.device_token";
const PROFILE_KEY = "patrol_log.admin.profile";

export const authStore = {
  getToken(): string | null { return localStorage.getItem(TOKEN_KEY); },
  setToken(v: string): void { localStorage.setItem(TOKEN_KEY, v); },
  clearToken(): void { localStorage.removeItem(TOKEN_KEY); },
  getProfile(): any | null {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  setProfile(v: unknown): void { localStorage.setItem(PROFILE_KEY, JSON.stringify(v)); },
  clearProfile(): void { localStorage.removeItem(PROFILE_KEY); },
};

export const api = createApiClient({
  getBaseUrl: getApiBaseUrl,
  getDeviceToken: () => authStore.getToken(),
  onUnauthorized: () => {
    authStore.clearToken();
    authStore.clearProfile();
    if (location.pathname !== "/login") location.href = "/login";
  },
});

// Admin-only endpoints live under /admin and aren't in the shared API client.
// We use a thin fetch wrapper that reuses the same auth header.
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = authStore.getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) {
      authStore.clearToken();
      authStore.clearProfile();
      if (location.pathname !== "/login") location.href = "/login";
    }
    throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}
