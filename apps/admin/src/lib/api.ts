import { createApiClient } from "@patrol-log/shared";

// API base URL — points to your Cloudflare Workers deployment.
// Override with VITE_API_BASE_URL env var for local/dev.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "https://patrol-log-api.your-worker.workers.dev";

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
  baseUrl: API_BASE_URL,
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
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) {
      authStore.clearToken();
      authStore.clearProfile();
      if (location.pathname !== "/login") location.href = "/login";
    }
    throw new Error(body?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}
