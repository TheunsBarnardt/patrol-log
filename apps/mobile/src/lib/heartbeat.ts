// Heartbeat loop: while on patrol, grab GPS and POST to the live map.
// Uses a dedicated fetch so failures never force logout.
//
// Native (iOS/Android): background location task keeps sending with screen locked.
// Web: browsers freeze JS when locked — wake lock + resume flush only.

import * as Location from "expo-location";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { getApiBaseUrl } from "../config";
import { storage } from "./storage";
import { showLocalNotification } from "./notifications";
import {
  postHeartbeatFromLocation,
  startNativeBackgroundHeartbeat,
  stopNativeBackgroundHeartbeat,
} from "./heartbeatTask";

const INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let currentPatrolId: string | null = null;
let currentJti: string | null = null;
let running = false;
let sending = false;
let nativeBackground = false;
let lastCoords: {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  at: number;
} | null = null;
let watchSub: Location.LocationSubscription | null = null;
let wakeLock: { release: () => Promise<void>; addEventListener: (type: "release", fn: () => void) => void } | null =
  null;
let appStateSub: { remove: () => void } | null = null;
let visibilityHandler: (() => void) | null = null;

export async function startHeartbeat(patrolId: string, deviceTokenJti: string) {
  stopHeartbeat();
  currentPatrolId = patrolId;
  currentJti = deviceTokenJti;
  running = true;
  nativeBackground = false;

  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    console.warn("[heartbeat] location permission denied");
    return;
  }

  if (Platform.OS !== "web") {
    nativeBackground = await startNativeBackgroundHeartbeat(patrolId, deviceTokenJti);
    if (nativeBackground) {
      // Background task owns locked-screen updates; still send once now.
      await sendOnce();
      return;
    }
  }

  // Web, or native without "Always" permission — foreground loop + wake lock.
  await startWatch();
  await acquireKeepAwake();
  attachLifecycle();
  await sendOnce();
  scheduleNext(INTERVAL_MS);
}

export function stopHeartbeat() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  currentPatrolId = null;
  currentJti = null;
  lastCoords = null;
  nativeBackground = false;
  void stopWatch();
  void releaseKeepAwake();
  detachLifecycle();
  void stopNativeBackgroundHeartbeat();
}

function scheduleNext(ms: number) {
  if (!running || nativeBackground) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void (async () => {
      await sendOnce();
      scheduleNext(INTERVAL_MS);
    })();
  }, ms);
}

async function startWatch() {
  try {
    watchSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15_000,
        distanceInterval: 25,
        mayShowUserSettingsDialog: true,
      },
      (pos) => {
        lastCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        };
      },
    );
  } catch (err) {
    console.warn("[heartbeat] watchPosition failed", err);
  }
}

async function stopWatch() {
  try {
    watchSub?.remove();
  } catch {
    /* ignore */
  }
  watchSub = null;
}

async function acquireKeepAwake() {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (err) {
    console.warn("[heartbeat] wake lock unavailable", err);
  }
}

async function releaseKeepAwake() {
  try {
    if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* ignore */
  }
}

function attachLifecycle() {
  appStateSub = AppState.addEventListener("change", onAppState);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void onBecameActive();
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }
}

function detachLifecycle() {
  appStateSub?.remove();
  appStateSub = null;
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }
  visibilityHandler = null;
}

function onAppState(next: AppStateStatus) {
  if (next === "active") void onBecameActive();
}

async function onBecameActive() {
  if (!running || nativeBackground) return;
  await acquireKeepAwake();
  await sendOnce();
  scheduleNext(INTERVAL_MS);
}

async function resolveCoords(): Promise<{
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy_m: number;
} | null> {
  if (lastCoords && Date.now() - lastCoords.at < 90_000) {
    return {
      lat: lastCoords.lat,
      lng: lastCoords.lng,
      heading: lastCoords.heading ?? undefined,
      speed: lastCoords.speed ?? undefined,
      accuracy_m: lastCoords.accuracy ?? 9999,
    };
  }
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    });
    lastCoords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      accuracy: pos.coords.accuracy,
      at: Date.now(),
    };
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: pos.coords.heading ?? undefined,
      speed: pos.coords.speed ?? undefined,
      accuracy_m: pos.coords.accuracy ?? 9999,
    };
  } catch (err) {
    console.warn("[heartbeat] getCurrentPosition failed", err);
    if (lastCoords) {
      return {
        lat: lastCoords.lat,
        lng: lastCoords.lng,
        heading: lastCoords.heading ?? undefined,
        speed: lastCoords.speed ?? undefined,
        accuracy_m: lastCoords.accuracy ?? 9999,
      };
    }
    return null;
  }
}

async function sendOnce() {
  if (!currentPatrolId || !currentJti || !running) return;
  if (sending) return;
  sending = true;
  try {
    const coords = await resolveCoords();
    if (!coords) return;

    if (Platform.OS !== "web") {
      await postHeartbeatFromLocation(
        { patrolId: currentPatrolId, jti: currentJti },
        {
          lat: coords.lat,
          lng: coords.lng,
          heading: coords.heading,
          speed: coords.speed,
          accuracy: coords.accuracy_m,
        },
      );
      return;
    }

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
        lat: coords.lat,
        lng: coords.lng,
        heading: coords.heading,
        speed: coords.speed,
        accuracy_m: coords.accuracy_m,
        timestamp,
        signature,
      }),
      keepalive: true,
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
  } finally {
    sending = false;
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
