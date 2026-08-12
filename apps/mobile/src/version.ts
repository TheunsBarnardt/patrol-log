import Constants from "expo-constants";

/** Bump with `app.json` / `package.json` version so About shows deploy freshness. */
export const APP_VERSION =
  Constants.expoConfig?.version ??
  Constants.nativeAppVersion ??
  "0.2.2";

export const APP_NAME = "Patrol Log";
