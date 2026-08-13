// Heartbeat loop: while on patrol, grab GPS and POST to the live map.
// Uses a dedicated fetch so failures never force logout.
//
// Native (iOS/Android): background location task keeps sending with screen locked.
// Web: browsers freeze JS when locked — wake lock + resume flush only.

import * as Location from "expo-location";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { getApiBaseUrl } from "../config";
import { refreshScreenLock } from "./keepAwake";
import { appendTrackPoint, bindPatrolTrack } from "./patrolTrack";
import { storage } from "./storage";
import { showLocalNotification } from "./notifications";
import {
  postHeartbeatFromLocation,
  startNativeBackgroundHeartbeat,
  stopNativeBackgroundHeartbeat,
} from "./heartbeatTask";

const INTERVAL_MS = 20_000;
const GEO_TIMEOUT_MS = 8_000;
const COORDS_FRESH_MS = 180_000;

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
let appStateSub: { remove: () => void } | null = null;
let visibilityHandler: (() => void) | null = null;

export function isHeartbeatRunning(): boolean {
  return running && !!currentPatrolId;
}

/** Feed GPS from the live map so heartbeats never wait on a hanging getCurrentPosition. */
export function noteLocalCoords(coords: {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
}): void {
  lastCoords = {
    lat: coords.lat,
    lng: coords.lng,
    heading: coords.heading,
    speed: coords.speed,
    accuracy: coords.accuracy,
    at: Date.now(),
  };
  if (currentPatrolId) {
    appendTrackPoint(currentPatrolId, {
      lat: coords.lat,
      lng: coords.lng,
      accuracy: coords.accuracy,
    });
  }
}

export async function startHeartbeatForPatrol(patrolId: string): Promise<void> {
  const token = await storage.getDeviceToken();
  if (!token) return;
  const jti = decodeJti(token);
  if (!jti) return;
  await startHeartbeat(patrolId, jti);
}

/** Resume tracking after app reload if an active patrol is still cached. */
export async function ensureHeartbeatForActivePatrol(): Promise<string | null> {
  if (running && currentPatrolId) {
    if (!watchSub) void startWatch();
    void sendOnce();
    return currentPatrolId;
  }
  try {
    const [raw, token] = await Promise.all([storage.getActivePatrolCache(), storage.getDeviceToken()]);
    if (!raw || !token) return null;
    const parsed = JSON.parse(raw) as { patrol_id?: string };
    if (!parsed?.patrol_id) return null;
    const jti = decodeJti(token);
    if (!jti) return null;
    await startHeartbeat(parsed.patrol_id, jti);
    return parsed.patrol_id;
  } catch (err) {
    console.warn("[heartbeat] ensure failed", err);
    return null;
  }
}

export async function startHeartbeat(patrolId: string, deviceTokenJti: string) {
  if (running && currentPatrolId === patrolId && currentJti === deviceTokenJti) {
    if (!watchSub) await startWatch();
    void sendOnce();
    return;
  }
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

  await bindPatrolTrack(patrolId);

  if (Platform.OS !== "web") {
    nativeBackground = await startNativeBackgroundHeartbeat(patrolId, deviceTokenJti);
  }

  await startWatch();
  await refreshScreenLock();
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
  detachLifecycle();
  void stopNativeBackgroundHeartbeat();
}

function scheduleNext(ms: number) {
  if (!running) return;
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
        accuracy: Location.Accuracy.High,
        timeInterval: 10_000,
        distanceInterval: 8,
        mayShowUserSettingsDialog: true,
      },
      (pos) => {
        noteLocalCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
        });
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
  if (!running) return;
  await refreshScreenLock();
  await sendOnce();
  scheduleNext(INTERVAL_MS);
}

function fromLastCoords(): {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy_m: number;
} | null {
  if (!lastCoords) return null;
  return {
    lat: lastCoords.lat,
    lng: lastCoords.lng,
    heading: lastCoords.heading ?? undefined,
    speed: lastCoords.speed ?? undefined,
    accuracy_m: lastCoords.accuracy ?? 9999,
  };
}

function getPositionWithTimeout(): Promise<Location.LocationObject> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => reject(new Error("geolocation timeout")), GEO_TIMEOUT_MS);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(tid);
          resolve({
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              altitude: pos.coords.altitude,
              accuracy: pos.coords.accuracy,
              altitudeAccuracy: pos.coords.altitudeAccuracy,
              heading: pos.coords.heading,
              speed: pos.coords.speed,
            },
            timestamp: pos.timestamp,
          } as Location.LocationObject);
        },
        (err) => {
          clearTimeout(tid);
          reject(err);
        },
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 30_000 },
      );
    });
  }
  return Promise.race([
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("geolocation timeout")), GEO_TIMEOUT_MS);
    }),
  ]);
}

async function resolveCoords(): Promise<{
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy_m: number;
} | null> {
  if (lastCoords && Date.now() - lastCoords.at < COORDS_FRESH_MS) {
    return fromLastCoords();
  }
  try {
    const pos = await getPositionWithTimeout();
    lastCoords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      accuracy: pos.coords.accuracy,
      at: Date.now(),
    };
    return fromLastCoords();
  } catch (err) {
    console.warn("[heartbeat] getCurrentPosition failed", err);
    return fromLastCoords();
  }
}

async function sendOnce() {
  if (!currentPatrolId || !currentJti || !running) return;
  if (sending) return;
  sending = true;
  const watchdog = setTimeout(() => {
    sending = false;
  }, 12_000);
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

    if (res.status === 429) return;
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
    clearTimeout(watchdog);
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

function decodeJti(jwt: string): string | null {
  try {
    const [, payload] = jwt.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.jti === "string" ? json.jti : null;
  } catch {
    return null;
  }
}
