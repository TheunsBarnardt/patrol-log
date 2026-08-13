/**
 * Background location task for native (iOS/Android) live-map heartbeats.
 * Must be imported early from index.ts so TaskManager.defineTask runs at startup.
 * Does nothing on web — browsers cannot track with the screen locked.
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { getApiBaseUrl } from "../config";
import { appendTrackPoint, bindPatrolTrack, trailForHeartbeat } from "./patrolTrack";
import { storage } from "./storage";
import { showLocalNotification } from "./notifications";

export const HEARTBEAT_TASK_NAME = "PATROL_LOG_LIVE_HEARTBEAT";

const MIN_SEND_GAP_MS = 25_000;
let lastSentAt = 0;

type Session = { patrolId: string; jti: string };

async function readSession(): Promise<Session | null> {
  try {
    const raw = await storage.getHeartbeatSession();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.patrolId || !parsed?.jti) return null;
    return parsed;
  } catch {
    return null;
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

export async function postHeartbeatFromLocation(
  session: Session,
  coords: {
    lat: number;
    lng: number;
    heading?: number | null;
    speed?: number | null;
    accuracy?: number | null;
  },
): Promise<void> {
  await bindPatrolTrack(session.patrolId);
  appendTrackPoint(session.patrolId, {
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy,
  });
  const now = Date.now();
  if (now - lastSentAt < MIN_SEND_GAP_MS) return;
  lastSentAt = now;

  const token = await storage.getDeviceToken();
  if (!token) {
    console.warn("[heartbeat-task] no device token");
    return;
  }

  const timestamp = new Date().toISOString();
  const signature = await signHeartbeat(session.jti, session.patrolId, timestamp);

  const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/live-map/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      patrol_id: session.patrolId,
      lat: coords.lat,
      lng: coords.lng,
      heading: coords.heading ?? undefined,
      speed: coords.speed ?? undefined,
      accuracy_m: coords.accuracy ?? 9999,
      timestamp,
      signature,
      trail: trailForHeartbeat(),
    }),
  });

  if (res.status === 429) return;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[heartbeat-task] failed", res.status, text.slice(0, 160));
    return;
  }

  const result = (await res.json()) as { ok?: boolean; out_of_sector?: boolean };
  if (result.out_of_sector) {
    await showLocalNotification(
      "⚠ Outside sector boundary",
      "You have left your designated sector. Please return to your area.",
    );
  }
}

if (Platform.OS !== "web") {
  TaskManager.defineTask(HEARTBEAT_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn("[heartbeat-task] error", error.message);
      return;
    }
    const session = await readSession();
    if (!session) return;

    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    const loc = locations?.[locations.length - 1];
    if (!loc) return;

    try {
      await postHeartbeatFromLocation(session, {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        heading: loc.coords.heading,
        speed: loc.coords.speed,
        accuracy: loc.coords.accuracy,
      });
    } catch (err) {
      console.warn("[heartbeat-task] send failed", err);
    }
  });
}

export async function startNativeBackgroundHeartbeat(patrolId: string, jti: string): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    console.warn("[heartbeat] foreground location denied");
    return false;
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    console.warn("[heartbeat] background location denied — locked-screen tracking unavailable");
    // Still allow foreground loop in heartbeat.ts
    return false;
  }

  await storage.setHeartbeatSession(JSON.stringify({ patrolId, jti }));

  const started = await Location.hasStartedLocationUpdatesAsync(HEARTBEAT_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(HEARTBEAT_TASK_NAME);
  }

  await Location.startLocationUpdatesAsync(HEARTBEAT_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30_000,
    distanceInterval: 40,
    deferredUpdatesInterval: 30_000,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: "Patrol Log",
      notificationBody: "Sharing your location on the live map",
      notificationColor: "#0B3D8C",
    },
  });

  return true;
}

export async function stopNativeBackgroundHeartbeat(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(HEARTBEAT_TASK_NAME);
    if (started) await Location.stopLocationUpdatesAsync(HEARTBEAT_TASK_NAME);
  } catch (err) {
    console.warn("[heartbeat] stop background failed", err);
  }
  await storage.clearHeartbeatSession();
}
