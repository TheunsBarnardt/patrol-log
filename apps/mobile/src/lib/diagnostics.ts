/** Temporary mobile-data diagnostics — remove after field testing. */

import { Platform } from "react-native";
import { getApiBaseUrl } from "../config";
import { APP_VERSION } from "../version";

export const DIAG_SLOW_MS = 3000;
export const DIAG_TIMEOUT_MS = 12_000;

export type CheckStatus = "pending" | "running" | "pass" | "fail" | "slow";

export interface DiagCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  ms?: number;
}

export interface DiagReport {
  checks: DiagCheck[];
  overall: "pass" | "fail" | "slow";
  at: string;
  apiBase: string;
  appVersion: string;
  platform: string;
  /** True when overall is fail or slow — show share/log link. */
  needsAttention: boolean;
  logText: string;
  /** WhatsApp / share deep link with the log body. */
  logLink: string;
}

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/$/, "")}${path}`;
}

async function timedFetch(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; ms: number; body: string; error?: string }> {
  const started = Date.now();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    const body = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - started, body };
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    const error = err?.name === "AbortError" ? `timeout (>${timeoutMs}ms)` : (err?.message ?? String(err));
    return { ok: false, status: 0, ms: Date.now() - started, body: "", error };
  }
}

function buildLogText(report: Omit<DiagReport, "logText" | "logLink" | "needsAttention">): string {
  const lines = [
    "PATROL LOG — network diagnostic",
    `at: ${report.at}`,
    `app: v${report.appVersion}`,
    `platform: ${report.platform}`,
    `api: ${report.apiBase}`,
    `overall: ${report.overall}`,
    "",
    ...report.checks.map((c) => {
      const timing = c.ms != null ? ` ${c.ms}ms` : "";
      const detail = c.detail ? ` — ${c.detail}` : "";
      return `[${c.status.toUpperCase()}] ${c.label}${timing}${detail}`;
    }),
  ];
  return lines.join("\n");
}

/** Shareable link (WhatsApp) with the diagnostic log prefilled. */
export function buildDiagLogLink(logText: string): string {
  return `https://wa.me/?text=${encodeURIComponent(logText)}`;
}

export function initialDiagChecks(): DiagCheck[] {
  return [
    { id: "config", label: "App config (API URL)", status: "pending" },
    { id: "health", label: "API /health reachable", status: "pending" },
    { id: "latency", label: `Latency under ${DIAG_SLOW_MS}ms`, status: "pending" },
    { id: "payload", label: "API returns ok JSON", status: "pending" },
  ];
}

/**
 * Runs the temporary login checklist. Call `onUpdate` as each step finishes
 * so the UI can show live progress.
 */
export async function runNetworkDiagnostics(
  onUpdate?: (checks: DiagCheck[]) => void,
): Promise<DiagReport> {
  const checks = initialDiagChecks();
  const emit = () => onUpdate?.(checks.map((c) => ({ ...c })));

  // 1) Config
  checks[0] = {
    ...checks[0]!,
    status: "pass",
    detail: getApiBaseUrl().replace(/^https?:\/\//, ""),
  };
  emit();

  // 2–4) Health fetch
  checks[1] = { ...checks[1]!, status: "running" };
  checks[2] = { ...checks[2]!, status: "running" };
  checks[3] = { ...checks[3]!, status: "running" };
  emit();

  const result = await timedFetch(apiUrl("/health"), DIAG_TIMEOUT_MS);

  if (!result.ok || result.error) {
    checks[1] = {
      ...checks[1]!,
      status: "fail",
      ms: result.ms,
      detail: result.error ?? `HTTP ${result.status}`,
    };
    checks[2] = { ...checks[2]!, status: "fail", ms: result.ms, detail: "skipped — health failed" };
    checks[3] = { ...checks[3]!, status: "fail", ms: result.ms, detail: "skipped — health failed" };
  } else {
    checks[1] = {
      ...checks[1]!,
      status: "pass",
      ms: result.ms,
      detail: `HTTP ${result.status}`,
    };

    const slow = result.ms >= DIAG_SLOW_MS;
    checks[2] = {
      ...checks[2]!,
      status: slow ? "slow" : "pass",
      ms: result.ms,
      detail: slow ? `slow (${result.ms}ms ≥ ${DIAG_SLOW_MS}ms)` : `${result.ms}ms`,
    };

    let payloadOk = false;
    let payloadDetail = result.body.slice(0, 80);
    try {
      const json = JSON.parse(result.body) as { ok?: boolean; env?: string; name?: string };
      payloadOk = json.ok === true;
      payloadDetail = payloadOk
        ? `ok · ${json.name ?? "api"} · env=${json.env ?? "?"}`
        : `unexpected JSON: ${payloadDetail}`;
    } catch {
      payloadOk = false;
      payloadDetail = `not JSON: ${payloadDetail}`;
    }
    checks[3] = {
      ...checks[3]!,
      status: payloadOk ? "pass" : "fail",
      ms: result.ms,
      detail: payloadDetail,
    };
  }
  emit();

  const hasFail = checks.some((c) => c.status === "fail");
  const hasSlow = checks.some((c) => c.status === "slow");
  const overall: DiagReport["overall"] = hasFail ? "fail" : hasSlow ? "slow" : "pass";
  const at = new Date().toISOString();
  const base = {
    checks,
    overall,
    at,
    apiBase: getApiBaseUrl(),
    appVersion: APP_VERSION,
    platform: Platform.OS,
  };
  const logText = buildLogText(base);
  return {
    ...base,
    needsAttention: overall !== "pass",
    logText,
    logLink: buildDiagLogLink(logText),
  };
}
