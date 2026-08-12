import Constants from "expo-constants";
import { Platform } from "react-native";

const PRODUCTION_API = "https://patrol-log-api.small-night-657e.workers.dev";

const fromEnv =
  typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined;
const fromExtra = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

/**
 * Resolve at call time (not module load). Module-load resolution can bake in
 * workers.dev before `window` exists, which breaks SA mobile carriers.
 */
export function getApiBaseUrl(): string {
  if (fromEnv) return fromEnv;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8787";
    }
    // Same-origin Pages proxy — carriers that block *.workers.dev still reach *.pages.dev.
    if (host.endsWith(".pages.dev") || host.includes("patrol-log")) {
      return `${window.location.origin}/api`;
    }
  }
  return fromExtra || PRODUCTION_API;
}

/** @deprecated Prefer getApiBaseUrl() — kept for display/diagnostics. */
export const API_BASE_URL: string =
  typeof window !== "undefined" ? getApiBaseUrl() : fromExtra || PRODUCTION_API;

/** Origin for same-origin map asset/tile proxies (web Pages only). */
export function getMapAssetOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.endsWith(".pages.dev") || host.includes("patrol-log")) {
      return window.location.origin;
    }
  }
  // Fall back to production Pages host so native WebViews also avoid blocked CDNs.
  return "https://patrol-log-mobile.pages.dev";
}
