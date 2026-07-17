import Constants from "expo-constants";

// API base URL comes from app.json > expo.extra.apiBaseUrl.
// For production, point at your deployed Workers URL:
//   https://patrol-log-api.yourname.workers.dev
// For local dev, use http://localhost:8787 (Metro tunnel) or
// http://<your-machine-ip>:8787 for physical device testing.
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:8787";
