/** Online / offline detection + pending outbox count for the banner. */

import { create } from "zustand";
import { AppState, Platform } from "react-native";
import { getApiBaseUrl } from "../config";

interface ConnectivityState {
  online: boolean;
  pendingCount: number;
  setOnline: (v: boolean) => void;
  setPendingCount: (n: number) => void;
  probe: () => Promise<boolean>;
}

let started = false;
let lastOnline: boolean | null = null;

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: typeof navigator !== "undefined" ? navigator.onLine !== false : true,
  pendingCount: 0,
  setOnline(v) {
    set({ online: v });
  },
  setPendingCount(n) {
    set({ pendingCount: n });
  },
  async probe() {
    try {
      const base = getApiBaseUrl().replace(/\/$/, "");
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
      const res = await fetch(`${base}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ctrl?.signal,
      });
      if (timer) clearTimeout(timer);
      const ok = res.ok;
      set({ online: ok });
      return ok;
    } catch {
      set({ online: false });
      return false;
    }
  },
}));

export function startConnectivityMonitoring(onBecameOnline?: () => void): () => void {
  if (started) return () => {};
  started = true;

  const notifyIfBecameOnline = (ok: boolean) => {
    if (ok && lastOnline === false) onBecameOnline?.();
    lastOnline = ok;
  };

  void useConnectivityStore.getState().probe().then((ok) => {
    lastOnline = ok;
    if (ok) onBecameOnline?.();
  });

  const onWinOnline = () => {
    useConnectivityStore.getState().setOnline(true);
    void useConnectivityStore.getState().probe().then(notifyIfBecameOnline);
  };
  const onWinOffline = () => {
    lastOnline = false;
    useConnectivityStore.getState().setOnline(false);
  };

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("online", onWinOnline);
    window.addEventListener("offline", onWinOffline);
  }

  const appSub = AppState.addEventListener("change", (next) => {
    if (next === "active") {
      void useConnectivityStore.getState().probe().then(notifyIfBecameOnline);
    }
  });

  const interval = setInterval(() => {
    void useConnectivityStore.getState().probe().then(notifyIfBecameOnline);
  }, 30_000);

  return () => {
    started = false;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.removeEventListener("online", onWinOnline);
      window.removeEventListener("offline", onWinOffline);
    }
    appSub.remove();
    clearInterval(interval);
  };
}

export function isNetworkError(err: unknown): boolean {
  if (!err) return !useConnectivityStore.getState().online;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("offline")) {
    return true;
  }
  const status = (err as { status?: number })?.status;
  if (status === 0 || status === 502 || status === 503 || status === 504) return true;
  const code =
    (err as { body?: { error?: string } })?.body?.error ?? (err as { code?: string })?.code;
  if (code === "API_UNAVAILABLE") return true;
  return !useConnectivityStore.getState().online;
}
