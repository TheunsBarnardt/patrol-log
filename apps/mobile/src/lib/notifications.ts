// Local notification helpers for Patrol Log mobile app.
// Server-side FCM push notifications have been removed.
// The mobile app uses expo-notifications for local notifications only.
// Push token registration is kept for potential future use.

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
 * Request notification permissions.
 * Push token registration to the backend is optional since FCM has been removed.
 * The backend still accepts push tokens for potential future use.
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
      console.warn("[notifications] Notification permission denied");
      return;
    }

    // Store token locally for potential future use
    // The backend no longer sends FCM pushes — messages are in-app only
    console.log("[notifications] Permission granted. Local notifications enabled.");
  } catch (err) {
    console.warn("[notifications] Failed to register push token:", err);
  }
}

/**
 * Show an immediate local notification (no scheduling delay).
 * Used for out-of-sector alerts, urgent messages, etc.
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
