// Thin wrapper over expo-secure-store (native) / localStorage (web) for device tokens.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEYS = {
  deviceToken: "patrol_log.device_token",
  deviceId: "patrol_log.device_id",
  profile: "patrol_log.profile",
};

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const storage = {
  async getDeviceToken(): Promise<string | null> {
    return getItem(KEYS.deviceToken);
  },
  async setDeviceToken(v: string): Promise<void> {
    await setItem(KEYS.deviceToken, v);
  },
  async clearDeviceToken(): Promise<void> {
    await deleteItem(KEYS.deviceToken);
  },
  async getDeviceId(): Promise<string | null> {
    return getItem(KEYS.deviceId);
  },
  async setDeviceId(v: string): Promise<void> {
    await setItem(KEYS.deviceId, v);
  },
  async getProfile(): Promise<string | null> {
    return getItem(KEYS.profile);
  },
  async setProfile(v: string): Promise<void> {
    await setItem(KEYS.profile, v);
  },
  async clearProfile(): Promise<void> {
    await deleteItem(KEYS.profile);
  },
};
