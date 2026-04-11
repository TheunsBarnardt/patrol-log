// Direct Firebase Cloud Messaging HTTP v1 integration.
//
// Flow: service-account JSON → sign RS256 JWT → exchange for OAuth2 access
// token → POST to fcm.googleapis.com/v1/projects/{id}/messages:send
//
// The access token is cached in Worker memory for its full ~1h lifetime so
// we only sign one JWT per isolate. No state is persisted across deploys.

import type { Env } from "../env.js";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cached: { token: string; expiresAt: number } | null = null;

function b64urlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string"
      ? Uint8Array.from(atob(btoa(unescape(encodeURIComponent(input)))), (c) => c.charCodeAt(0))
      : input;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlJson(obj: unknown): string {
  return b64urlEncode(JSON.stringify(obj));
}

/** Convert a PEM PKCS#8 private key to a CryptoKey for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Sign a JWT and exchange it for a Google OAuth2 access token. */
async function fetchAccessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "RS256", typ: "JWT" });
  const claims = b64urlJson({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });
  const unsigned = `${header}.${claims}`;

  const key = await importPrivateKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const signature = b64urlEncode(new Uint8Array(sigBuf));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM OAuth2 token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

/**
 * Send a push notification to one or more FCM device tokens.
 * Best-effort: logs and swallows errors so caller never fails on push.
 */
export async function sendFcm(
  env: Env,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> {
  if (!tokens.length) return;
  if (!env.FCM_SERVICE_ACCOUNT) {
    console.warn("[fcm] FCM_SERVICE_ACCOUNT secret not set — skipping push");
    return;
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount;
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      throw new Error("missing fields");
    }
  } catch (e) {
    console.error("[fcm] FCM_SERVICE_ACCOUNT JSON invalid", e);
    return;
  }

  let accessToken: string;
  try {
    accessToken = await fetchAccessToken(sa);
  } catch (e) {
    console.error("[fcm] could not fetch OAuth2 access token", e);
    return;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  // Stringify all data values — FCM v1 requires them to be strings
  const stringifiedData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    stringifiedData[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  // FCM v1 has no multicast — one request per token
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body: body.slice(0, 240) },
              data: stringifiedData,
              android: {
                priority: "HIGH",
                notification: {
                  channel_id: "default",
                  sound: "default",
                  default_vibrate_timings: true,
                },
              },
            },
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.warn(`[fcm] send failed (${res.status}): ${text.slice(0, 200)}`);
        }
      } catch (e) {
        console.warn("[fcm] send error", e);
      }
    }),
  );
}
