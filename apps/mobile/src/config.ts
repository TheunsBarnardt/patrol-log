import Constants from "expo-constants";

// API base URL comes from app.json > expo.extra.apiBaseUrl.
// Override for device testing by pointing at your tunneled dev URL or the
// deployed Workers URL, e.g. https://patrol-log-api.yourname.workers.dev
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:8787";
