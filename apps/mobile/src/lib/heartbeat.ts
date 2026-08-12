// POC heartbeat loop. Every 30s while an active patrol exists, grab GPS and POST to the API.
// Uses a dedicated fetch path so heartbeat failures never force logout.

import * as Location from "expo-location";
import { getApiBaseUrl } from "../config";
import { storage } from "./storage";
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
    const token = await storage.getDeviceToken();
    if (!token) {
      console.warn("[heartbeat] skipped — no device token");
      return;
    }

    const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/live-map/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        patrol_id: currentPatrolId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: pos.coords.heading ?? undefined,
        speed: pos.coords.speed ?? undefined,
        accuracy_m: pos.coords.accuracy ?? 9999,
        timestamp,
        signature,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[heartbeat] failed", res.status, text.slice(0, 160));
      return;
    }

    const result = (await res.json()) as { ok?: boolean; out_of_sector?: boolean };
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

async function signHeartbeat(jti: string, patrolId: string, timestamp: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(jti), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${patrolId}|${timestamp}`));
  return bytesToBase64Url(new Uint8Array(mac));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
