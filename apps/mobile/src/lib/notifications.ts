// Push token registration and local notification helpers.
// Uses expo-notifications (SDK 51 compatible ~0.28.0).

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
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
 * Request permission + register Expo push token with the backend.
 * Call after successful login (and after EAS projectId is configured).
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

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId || projectId === "YOUR_EXPO_PROJECT_ID") {
      console.warn("[notifications] No Expo projectId configured — skipping push token registration");
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken({
      expo_token: tokenData.data,
      platform: Platform.OS,
    });
    console.log("[notifications] Push token registered:", tokenData.data);
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
