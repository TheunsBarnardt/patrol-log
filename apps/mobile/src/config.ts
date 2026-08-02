import Constants from "expo-constants";
import { Platform } from "react-native";

// API base URL comes from app.json > expo.extra.apiBaseUrl.
// Web (same machine) defaults to localhost; native uses LAN/production URL from extra.
const fromExtra = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

export const API_BASE_URL: string =
  Platform.OS === "web"
    ? "http://localhost:8787"
    : (fromExtra ?? "http://localhost:8787");
