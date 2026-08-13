/**
 * Keep the phone screen on (native FLAG_KEEP_SCREEN_ON / idleTimerDisabled,
 * plus the browser Screen Wake Lock API). Browsers drop the lock when the tab
 * hides — we re-request on resume and on the next tap.
 */
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const TAG = "patrol-log-screen";

type WebWakeLock = {
  release: () => Promise<void>;
  addEventListener: (type: "release", fn: () => void) => void;
};

let webLock: WebWakeLock | null = null;
let expoOn = false;

async function acquireWebLock(): Promise<void> {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return;
  const api = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WebWakeLock> } })
    .wakeLock;
  if (!api) return;
  try {
    if (webLock) return;
    webLock = await api.request("screen");
    webLock.addEventListener("release", () => {
      webLock = null;
    });
  } catch (err) {
    console.warn("[keepAwake] wake lock unavailable", err);
  }
}

async function acquireExpo(): Promise<void> {
  try {
    await activateKeepAwakeAsync(TAG);
    expoOn = true;
  } catch (err) {
    console.warn("[keepAwake] native keep-awake failed", err);
  }
}

export async function refreshScreenLock(): Promise<void> {
  await acquireExpo();
  await acquireWebLock();
}

export async function releaseScreenLock(): Promise<void> {
  if (expoOn) {
    try {
      deactivateKeepAwake(TAG);
    } catch {
      /* ignore */
    }
    expoOn = false;
  }
  try {
    if (webLock) {
      await webLock.release();
      webLock = null;
    }
  } catch {
    /* ignore */
  }
}

/** While `enabled`, the screen will not auto-lock. Safe on web and native. */
export function useKeepScreenOn(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    void refreshScreenLock();

    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshScreenLock();
    });

    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refreshScreenLock();
      }
    };
    const onInteract = () => {
      void refreshScreenLock();
    };

    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
      document.addEventListener("pointerdown", onInteract, { passive: true });
    }

    return () => {
      appSub.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
        document.removeEventListener("pointerdown", onInteract);
      }
      void releaseScreenLock();
    };
  }, [enabled]);
}
