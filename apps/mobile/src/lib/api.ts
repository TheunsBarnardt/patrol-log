import { createApiClient } from "@patrol-log/shared";
import { API_BASE_URL } from "../config";
import { storage } from "./storage";
import { useAuthStore } from "../store/auth";

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getDeviceToken: () => storage.getDeviceToken(),
  onUnauthorized: () => {
    useAuthStore.getState().signOut();
  },
});
