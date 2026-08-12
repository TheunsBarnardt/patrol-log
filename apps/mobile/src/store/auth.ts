import { create } from "zustand";
import type { PatrollerProfile } from "@patrol-log/shared";
import { storage } from "../lib/storage";
import { stopHeartbeat } from "../lib/heartbeat";

interface AuthState {
  status: "bootstrapping" | "unauthenticated" | "authenticated";
  profile: PatrollerProfile | null;
  deviceToken: string | null;
  setAuthenticated: (profile: PatrollerProfile, deviceToken: string) => Promise<void>;
  setUnauthenticated: () => void;
  bootstrap: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  profile: null,
  deviceToken: null,

  async setAuthenticated(profile, deviceToken) {
    await storage.setDeviceToken(deviceToken);
    await storage.setProfile(JSON.stringify(profile));
    set({ status: "authenticated", profile, deviceToken });
  },

  setUnauthenticated() {
    stopHeartbeat();
    set({ status: "unauthenticated", profile: null, deviceToken: null });
  },

  async bootstrap() {
    const [token, profileJson] = await Promise.all([storage.getDeviceToken(), storage.getProfile()]);
    if (token && profileJson) {
      try {
        set({
          status: "authenticated",
          profile: JSON.parse(profileJson),
          deviceToken: token,
        });
        return;
      } catch {}
    }
    set({ status: "unauthenticated", profile: null, deviceToken: null });
  },

  async signOut() {
    stopHeartbeat();
    await storage.clearDeviceToken();
    await storage.clearProfile();
    await storage.clearActivePatrolCache();
    // Keep directory/map caches on device (WhatsApp-style).
    set({ status: "unauthenticated", profile: null, deviceToken: null });
  },
}));
