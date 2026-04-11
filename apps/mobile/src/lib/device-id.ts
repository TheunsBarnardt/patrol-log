import * as Application from "expo-application";
import { Platform } from "react-native";
import { storage } from "./storage";

// Stable per-install device id. Tries Expo/Android/iOS native identifier first,
// then falls back to a randomly generated id cached in SecureStore.
export async function getOrCreateDeviceId(): Promise<string> {
  const cached = await storage.getDeviceId();
  if (cached) return cached;

  let native: string | null = null;
  try {
    if (Platform.OS === "android") {
      native = Application.getAndroidId() ?? null;
    } else if (Platform.OS === "ios") {
      native = (await Application.getIosIdForVendorAsync()) ?? null;
    }
  } catch {}

  const id = native || randomId();
  await storage.setDeviceId(id);
  return id;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
