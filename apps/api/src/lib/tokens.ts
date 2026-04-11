// Device-bound JWT tokens (HS256) for WhatsApp-style persistent sessions.
// FDL: patroller-login.rules.session.model = whatsapp_style_device_bound
//      Long-lived, rotatable, revocable server-side.

import { SignJWT, jwtVerify } from "jose";

export interface DeviceTokenClaims {
  sub: string;        // patroller_id
  cs: string;         // call_sign
  al: string;         // access_level
  cpf: string;        // cpf_id
  sec: string;        // sector_id
  dev: string;        // device_id
  jti: string;        // token unique id (persisted in `devices` row)
  iat: number;
  exp: number;
}

export async function signDeviceToken(
  secret: string,
  claims: Omit<DeviceTokenClaims, "iat" | "exp" | "jti">,
): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // Long-lived: 1 year. Revocation is via the `devices.status` column, not expiry.
  const exp = now + 60 * 60 * 24 * 365;
  const token = await new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(new TextEncoder().encode(secret));
  return { token, jti };
}

export async function verifyDeviceToken(secret: string, token: string): Promise<DeviceTokenClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
  return payload as unknown as DeviceTokenClaims;
}

// Opaque heartbeat signature: HMAC-SHA256 of `patrol_id|timestamp` using the device token's JTI as key.
// FDL: live-patroller-map.rules.security.heartbeat_signature_required
export async function signHeartbeat(jti: string, patrolId: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jti),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${patrolId}|${timestamp}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifyHeartbeat(jti: string, patrolId: string, timestamp: string, signature: string): Promise<boolean> {
  const expected = await signHeartbeat(jti, patrolId, timestamp);
  // Constant-time comparison.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
