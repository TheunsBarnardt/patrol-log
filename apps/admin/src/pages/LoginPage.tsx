// Admin login reuses the patroller-login endpoint; the route guards on access_level.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, authStore } from "../lib/api";
import { APP_VERSION } from "../version";

export function LoginPage() {
  const [callSign, setCallSign] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await api.login({
        call_sign: callSign.trim().toUpperCase(),
        password,
        device_id: getOrCreateBrowserDeviceId(),
      });
      const level = res.patroller.access_level;
      if (
        level !== "system_admin" &&
        level !== "admin" &&
        level !== "sector_lead" &&
        level !== "call_centre_agent" &&
        level !== "patroller"
      ) {
        setErr("This account cannot sign in to the portal.");
        return;
      }
      authStore.setToken(res.device_token);
      authStore.setProfile(res.patroller);
      navigate(level === "patroller" ? "/my-details" : "/", { replace: true });
    } catch (e: any) {
      setErr(e?.body?.message ?? e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-gray-50 px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow"
      >
        <div className="text-center">
          <img
            src="/LOGO.jpg"
            alt="CPF Logo"
            className="mx-auto mb-3 h-20 w-20 rounded-full object-cover shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <h1 className="text-2xl font-extrabold">PATROL LOG</h1>
          <p className="text-sm text-gray-500">Admin Portal</p>
          <p className="mt-1 text-xs font-medium text-gray-400">v{APP_VERSION}</p>
        </div>
        <label className="block">
          <span className="text-sm font-semibold">Call sign</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-3 py-3 text-base uppercase"
            value={callSign}
            onChange={(e) => setCallSign(e.target.value)}
            autoFocus
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Password</span>
          <span className="relative mt-1 block">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full rounded border border-gray-300 px-3 py-3 pr-12 text-base"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-gray-500 hover:text-gray-800"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-primary py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Please wait..." : "Login"}
        </button>
      </form>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2.5 2.5 0 003.8 3.2" />
      <path d="M9.9 5.2A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a18.4 18.4 0 01-3.2 4.2" />
      <path d="M6.1 6.1C3.7 7.8 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8" />
    </svg>
  );
}

function getOrCreateBrowserDeviceId(): string {
  const key = "patrol_log.admin.device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, id);
  }
  return id;
}
