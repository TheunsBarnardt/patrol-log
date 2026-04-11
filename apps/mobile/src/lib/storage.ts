// Thin wrapper over expo-secure-store for device tokens.

import * as SecureStore from "expo-secure-store";

const KEYS = {
  deviceToken: "patrol_log.device_token",
  deviceId: "patrol_log.device_id",
  profile: "patrol_log.profile",
};

export const storage = {
  async getDeviceToken(): Promise<string | null> { return SecureStore.getItemAsync(KEYS.deviceToken); },
  async setDeviceToken(v: string): Promise<void> { await SecureStore.setItemAsync(KEYS.deviceToken, v); },
  async clearDeviceToken(): Promise<void> { await SecureStore.deleteItemAsync(KEYS.deviceToken); },
  async getDeviceId(): Promise<string | null> { return SecureStore.getItemAsync(KEYS.deviceId); },
  async setDeviceId(v: string): Promise<void> { await SecureStore.setItemAsync(KEYS.deviceId, v); },
  async getProfile(): Promise<string | null> { return SecureStore.getItemAsync(KEYS.profile); },
  async setProfile(v: string): Promise<void> { await SecureStore.setItemAsync(KEYS.profile, v); },
  async clearProfile(): Promise<void> { await SecureStore.deleteItemAsync(KEYS.profile); },
};
