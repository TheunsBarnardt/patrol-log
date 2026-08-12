/** Queued mutations for offline capture + stand-down. */

import type { CapturePatrolRequest, StandDownRequest } from "@patrol-log/shared";
import { api } from "./api";
import { bulkStorage } from "./bulkStorage";
import { useConnectivityStore } from "./connectivity";
import { storage } from "./storage";
import { notify } from "./notify";

const OUTBOX_KEY = "patrol_log.outbox";

export type OutboxItem =
  | {
      id: string;
      type: "capture";
      payload: CapturePatrolRequest;
      createdAt: string;
      retries: number;
    }
  | {
      id: string;
      type: "standDown";
      payload: { patrolId: string; body: StandDownRequest };
      createdAt: string;
      retries: number;
    };

function newId(): string {
  return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readQueue(): Promise<OutboxItem[]> {
  try {
    const raw = await bulkStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: OutboxItem[]): Promise<void> {
  await bulkStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  useConnectivityStore.getState().setPendingCount(items.length);
}

export async function refreshOutboxCount(): Promise<number> {
  const items = await readQueue();
  useConnectivityStore.getState().setPendingCount(items.length);
  return items.length;
}

export async function enqueueCapture(payload: CapturePatrolRequest): Promise<OutboxItem> {
  const items = await readQueue();
  const item: OutboxItem = {
    id: newId(),
    type: "capture",
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  items.push(item);
  await writeQueue(items);
  return item;
}

export async function enqueueStandDown(
  patrolId: string,
  body: StandDownRequest,
): Promise<OutboxItem> {
  const items = await readQueue();
  // Replace any existing stand-down for same patrol
  const filtered = items.filter((i) => !(i.type === "standDown" && i.payload.patrolId === patrolId));
  const item: OutboxItem = {
    id: newId(),
    type: "standDown",
    payload: { patrolId, body },
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  filtered.push(item);
  await writeQueue(filtered);
  return item;
}

let flushing = false;

export async function flushOutbox(): Promise<{ ok: number; fail: number }> {
  if (flushing) return { ok: 0, fail: 0 };
  flushing = true;
  let ok = 0;
  let fail = 0;
  try {
    const online = await useConnectivityStore.getState().probe();
    if (!online) return { ok: 0, fail: 0 };

    let items = await readQueue();
    const remaining: OutboxItem[] = [];

    for (const item of items) {
      try {
        if (item.type === "capture") {
          await api.capturePatrol(item.payload);
        } else {
          await api.standDown(item.payload.patrolId, item.payload.body);
          await storage.clearActivePatrolCache();
        }
        ok += 1;
      } catch (err) {
        fail += 1;
        remaining.push({ ...item, retries: item.retries + 1 });
        console.warn("[outbox] flush item failed", item.id, err);
      }
    }

    await writeQueue(remaining);

    if (ok > 0) {
      notify(
        "Synced",
        fail > 0
          ? `${ok} offline action${ok === 1 ? "" : "s"} synced · ${fail} still pending`
          : `${ok} offline action${ok === 1 ? "" : "s"} synced`,
      );
    }
  } finally {
    flushing = false;
  }
  return { ok, fail };
}
