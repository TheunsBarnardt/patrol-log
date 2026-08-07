import { createApiClient } from "@patrol-log/shared";
import { API_BASE_URL } from "../config";
import { storage } from "./storage";
import { useAuthStore } from "../store/auth";

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  // Prefer in-memory token so a SecureStore hiccup during live-map polling
  // can't send an unauthenticated request and bounce the user to login.
  getDeviceToken: async () => {
    const fromStore = useAuthStore.getState().deviceToken;
    if (fromStore) return fromStore;
    return storage.getDeviceToken();
  },
  onUnauthorized: () => {
    void useAuthStore.getState().signOut();
  },
});
