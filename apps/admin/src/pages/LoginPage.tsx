// Admin login reuses the patroller-login endpoint; the route guards on access_level.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, authStore } from "../lib/api";
import { APP_VERSION } from "../version";

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
          <input
            type="password"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-3 text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
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
