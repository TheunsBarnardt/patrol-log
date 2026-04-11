// Password hashing for Patrol Log.
// FDL: patroller-login.rules.security.password_hashing.algorithm = argon2id
//      patroller-login.rules.security.password_hashing.constant_time_comparison = true
//
// POC note: we would prefer argon2id, but Cloudflare Workers disallows runtime
// WebAssembly.compile() from Uint8Array, which breaks hash-wasm's argon2 at runtime.
// Scrypt is memory-hard like argon2id and works in pure JavaScript, so we use it
// via @noble/hashes. When the Workers runtime or a future alternative permits dynamic
// WASM (or we ship a statically-bundled argon2 module), switch back to argon2id.
//
// Work factor: N=2048 keeps hashing under the Workers Free plan's 10ms CPU budget
// on edge nodes. Paid plan can safely bump to N=16384 for production.

import { scryptAsync } from "@noble/hashes/scrypt";

const N = 2048;     // cost factor (must be power of 2)
const r = 8;        // block size
const p = 1;        // parallelization
const DK_LEN = 32;  // derived key length in bytes

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomSalt();
  const dk = await scryptAsync(password, salt, { N, r, p, dkLen: DK_LEN });
  return `scrypt$${N}$${r}$${p}$${b64(salt)}$${b64(dk)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N_ = Number(parts[1]);
  const r_ = Number(parts[2]);
  const p_ = Number(parts[3]);
  const salt = unb64(parts[4]);
  const expected = unb64(parts[5]);
  if (!Number.isFinite(N_) || !Number.isFinite(r_) || !Number.isFinite(p_)) return false;
  const computed = await scryptAsync(password, salt, { N: N_, r: r_, p: p_, dkLen: expected.length });
  // Constant-time comparison
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed[i] ^ expected[i];
  return diff === 0;
}
