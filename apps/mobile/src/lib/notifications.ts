// Push token registration and local notification helpers.
// Uses expo-notifications (SDK 51 compatible ~0.28.x).
//
// NOTE: we intentionally use getDevicePushTokenAsync() — this returns the
// raw FCM registration token on Android (and the APNs token on iOS). The
// backend sends pushes directly to Firebase Cloud Messaging v1, so we
// skip the Expo push relay entirely.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "./api";

// Configure how notifications appear when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request permission + register the device's FCM token with the backend.
 * Safe to call multiple times — the backend upserts by patroller_id.
 */
export async function registerPushToken(): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("[notifications] Push permission denied");
      return;
    }

    // getDevicePushTokenAsync returns the raw FCM/APNs token.
    // On Android this requires google-services.json to be embedded in the APK
    // (configured via `eas credentials --platform android`).
    const tokenData = await Notifications.getDevicePushTokenAsync();
    if (!tokenData?.data) {
      console.warn("[notifications] getDevicePushTokenAsync returned no token");
      return;
    }

    await api.registerPushToken({
      expo_token: tokenData.data, // field name kept for wire compat — it's actually an FCM token
      platform: Platform.OS,
    });
    console.log("[notifications] FCM token registered:", tokenData.data.slice(0, 24) + "…");
  } catch (err) {
    console.warn("[notifications] Failed to register push token:", err);
  }
}

/**
 * Show an immediate local notification (no scheduling delay).
 */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null, // fire immediately
    });
  } catch (err) {
    console.warn("[notifications] Failed to show local notification:", err);
  }
}
