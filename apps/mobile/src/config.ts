import Constants from "expo-constants";
import { Platform } from "react-native";

const PRODUCTION_API = "https://patrol-log-api.small-night-657e.workers.dev";

// Override with EXPO_PUBLIC_API_BASE_URL, else app.json extra.apiBaseUrl.
const fromEnv =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined;
const fromExtra = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

function resolveApiBaseUrl(): string {
  if (fromEnv) return fromEnv;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8787";
    }
    // Same-origin /api proxy on Pages — some mobile carriers time out on *.workers.dev
    // while *.pages.dev still loads. Native builds keep talking to the Worker directly.
    if (host.endsWith(".pages.dev") || host === "patrol-log-mobile.pages.dev") {
      return `${window.location.origin}/api`;
    }
  }
  return fromExtra || PRODUCTION_API;
}

export const API_BASE_URL: string = resolveApiBaseUrl();
