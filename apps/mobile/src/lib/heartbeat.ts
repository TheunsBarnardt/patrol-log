// POC heartbeat loop. Every 30s while an active patrol exists, grab GPS and POST to the API.
// We use a simple setInterval — good enough for foreground use. For production you'd use
// expo-task-manager + expo-background-fetch for true background execution.

import * as Location from "expo-location";
import { api } from "./api";
import { showLocalNotification } from "./notifications";

let timer: ReturnType<typeof setInterval> | null = null;
let currentPatrolId: string | null = null;
let currentJti: string | null = null;

export async function startHeartbeat(patrolId: string, deviceTokenJti: string) {
  stopHeartbeat();
  currentPatrolId = patrolId;
  currentJti = deviceTokenJti;

  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    console.warn("[heartbeat] location permission denied");
    return;
  }
  await sendOnce();
  timer = setInterval(() => {
    void sendOnce();
  }, 30_000);
}

export function stopHeartbeat() {
  if (timer) clearInterval(timer);
  timer = null;
  currentPatrolId = null;
  currentJti = null;
}

async function sendOnce() {
  if (!currentPatrolId || !currentJti) return;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const timestamp = new Date().toISOString();
    const signature = await signHeartbeat(currentJti, currentPatrolId, timestamp);
    const result = await api.heartbeat({
      patrol_id: currentPatrolId,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: pos.coords.heading ?? undefined,
      speed: pos.coords.speed ?? undefined,
      accuracy_m: pos.coords.accuracy ?? 9999,
      timestamp,
      signature,
    });

    // If the API reports out-of-sector, fire an immediate local notification
    if (result.out_of_sector) {
      await showLocalNotification(
        "⚠ Outside sector boundary",
        "You have left your designated sector. Please return to your area.",
      );
    }
  } catch (err) {
    console.warn("[heartbeat] failed", err);
  }
}

// HMAC-SHA256 in React Native — expo-crypto doesn't ship HMAC in SDK 51, so we use
// a tiny WebCrypto polyfill path. Since Expo SDK 51 has globalThis.crypto.subtle,
// this works directly.
async function signHeartbeat(jti: string, patrolId: string, timestamp: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(jti), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${patrolId}|${timestamp}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
