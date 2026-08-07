import Constants from "expo-constants";
import { Platform } from "react-native";

const PRODUCTION_API = "https://patrol-log-api.small-night-657e.workers.dev";

// Override with EXPO_PUBLIC_API_BASE_URL, else app.json extra.apiBaseUrl.
const fromEnv =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined;
const fromExtra = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

function resolveApiBaseUrl(): string {
  if (fromEnv) return fromEnv;
  // Local Expo web → local API; production web/native → Cloudflare Worker.
  if (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    return "http://localhost:8787";
  }
  return fromExtra || PRODUCTION_API;
}

export const API_BASE_URL: string = resolveApiBaseUrl();
