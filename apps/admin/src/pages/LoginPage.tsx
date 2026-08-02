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
    <div className="h-full grid place-items-center bg-gray-50">
      <form onSubmit={submit} className="w-full max-w-sm bg-white p-6 rounded-lg shadow border border-gray-200 space-y-4">
        <div className="text-center">
          <img
            src="/LOGO.jpg"
            alt="CPF Logo"
            className="mx-auto mb-3 h-20 w-20 rounded-full object-cover shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <h1 className="text-2xl font-extrabold">PATROL LOG</h1>
          <p className="text-sm text-gray-500">Admin Portal</p>
        </div>
        <label className="block">
          <span className="text-sm font-semibold">Call sign</span>
          <input
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 uppercase"
            value={callSign}
            onChange={(e) => setCallSign(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Password</span>
          <input
            type="password"
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-brand-primary text-white rounded-md py-2 font-semibold disabled:opacity-60"
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
