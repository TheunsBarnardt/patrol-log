// Admin login reuses the patroller-login endpoint; the route guards on access_level.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, authStore } from "../lib/api";

export function LoginPage() {
  const [callSign, setCallSign] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="app-shell grid h-full place-items-center px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-brand-line bg-white shadow-soft"
      >
        <div className="brand-stripe h-1.5 w-full" />
        <div className="space-y-5 px-6 py-7">
          <div className="text-center">
            <img
              src="/LOGO.jpg"
              alt="CPF Logo"
              className="mx-auto mb-4 h-24 w-24 rounded-full object-cover shadow-card ring-4 ring-brand-yellow/50"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <h1 className="text-2xl font-extrabold tracking-tight text-brand-ink">PATROL LOG</h1>
            <p className="mt-1 text-sm font-medium text-brand-muted">Wierdabrug CPF · Admin Portal</p>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-brand-ink">Call sign</span>
            <input
              className="mt-1.5 w-full rounded-xl border border-brand-line px-3 py-3 uppercase shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25"
              value={callSign}
              onChange={(e) => setCallSign(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-brand-ink">Password</span>
            <input
              type="password"
              className="mt-1.5 w-full rounded-xl border border-brand-line px-3 py-3 shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {err && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-brand-accent">{err}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand-primary py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-primaryDark disabled:opacity-60 active:scale-[0.99]"
          >
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
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
