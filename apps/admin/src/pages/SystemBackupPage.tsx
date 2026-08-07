import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, authStore } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import { Btn } from "../components/Modal";
import {
  createBackupOn,
  defaultOtherBase,
  loginSystemAdmin,
  restoreOn,
} from "../lib/syncApi";

interface BackupMeta {
  id: string;
  createdAt: string;
  createdByCallSign: string;
  label: string | null;
  byteSize: number;
  tableCounts: Record<string, number> | null;
}

interface BackupCreateResponse {
  id: string;
  createdAt: string;
  stored: boolean;
  byteSize: number;
  tableCounts: Record<string, number>;
  payload: unknown;
  note: string;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function currentApiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";
}

export function SystemBackupPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [otherBase, setOtherBase] = useState(() => defaultOtherBase(currentApiBase()));
  const [syncCallSign, setSyncCallSign] = useState("SYS01");
  const [syncPassword, setSyncPassword] = useState("");

  const { data: health } = useQuery({
    queryKey: ["api.health"],
    queryFn: () => adminFetch<{ env?: string; name?: string }>("/health"),
  });
  const isProd = (health?.env ?? "").toLowerCase() === "production";

  const { data, isLoading } = useQuery({
    queryKey: ["admin.system.backups"],
    queryFn: () => adminFetch<{ results: BackupMeta[] }>("/admin/system/backups"),
  });

  function restoreConfirmToken() {
    return isProd ? "RESTORE_PRODUCTION" : "RESTORE";
  }

  const createBackup = useMutation({
    mutationFn: () =>
      adminFetch<BackupCreateResponse>("/admin/system/backup", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() || undefined }),
      }),
    onSuccess: (res) => {
      setErr(null);
      setMsg(res.note);
      downloadJson(`patrol-log-backup-${res.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.json`, res.payload);
      qc.invalidateQueries({ queryKey: ["admin.system.backups"] });
      setLabel("");
    },
    onError: (e: Error) => {
      setMsg(null);
      setErr(e.message);
    },
  });

  const exportCsv = useMutation({
    mutationFn: () => adminFetch<{ files: Record<string, string>; exportedAt: string }>("/admin/system/export/csv"),
    onSuccess: (res) => {
      setErr(null);
      const names = Object.keys(res.files);
      for (const name of names) {
        downloadText(name, res.files[name] ?? "");
      }
      setMsg(`Downloaded ${names.length} CSV files. Keep these before any seed.`);
    },
    onError: (e: Error) => {
      setMsg(null);
      setErr(e.message);
    },
  });

  const restoreStored = useMutation({
    mutationFn: (backupId: string) =>
      adminFetch<{ ok: true }>("/admin/system/restore", {
        method: "POST",
        body: JSON.stringify({
          backup_id: backupId,
          confirm: restoreConfirmToken(),
          source: "stored-backup",
        }),
      }),
    onSuccess: () => {
      setErr(null);
      setMsg("Restore complete. Log out and log back in.");
    },
    onError: (e: Error) => {
      setMsg(null);
      setErr(e.message);
    },
  });

  const restoreUpload = useMutation({
    mutationFn: (payload: unknown) =>
      adminFetch<{ ok: true }>("/admin/system/restore", {
        method: "POST",
        body: JSON.stringify({
          payload,
          confirm: restoreConfirmToken(),
          source: "upload",
        }),
      }),
    onSuccess: () => {
      setErr(null);
      setMsg("Restore from file complete. Log out and log back in.");
    },
    onError: (e: Error) => {
      setMsg(null);
      setErr(e.message);
    },
  });

  const syncPull = useMutation({
    mutationFn: async () => {
      // Other env → current env (e.g. Cloudflare → this API)
      const other = await loginSystemAdmin(otherBase, syncCallSign, syncPassword);
      const { payload, env: fromEnv } = await createBackupOn(otherBase, other.token, "sync-pull");
      const localToken = authStore.getToken();
      if (!localToken) throw new Error("Not logged in on this API");
      await restoreOn(currentApiBase(), localToken, payload, `pull-from-${fromEnv}`);
      return fromEnv;
    },
    onSuccess: (fromEnv) => {
      setErr(null);
      setMsg(`Pulled from ${fromEnv} (${otherBase}) into this environment. Log out and back in.`);
      qc.invalidateQueries({ queryKey: ["admin.system.backups"] });
    },
    onError: (e: Error) => {
      setMsg(null);
      setErr(e.message);
    },
  });

  const syncPush = useMutation({
    mutationFn: async () => {
      // Current env → other env (e.g. local → Cloudflare)
      if (
        !confirm(
          `PUSH will REPLACE all operational data on:\n${otherBase}\n\nwith data from this environment.\nsystem_backups on the target are kept.\n\nContinue?`,
        )
      ) {
        throw new Error("Push cancelled");
      }
      const localToken = authStore.getToken();
      if (!localToken) throw new Error("Not logged in on this API");
      const { payload, env: fromEnv } = await createBackupOn(
        currentApiBase(),
        localToken,
        "sync-push",
      );
      const other = await loginSystemAdmin(otherBase, syncCallSign, syncPassword);
      await restoreOn(otherBase, other.token, payload, `push-from-${fromEnv}`);
      return other.env;
    },
    onSuccess: (toEnv) => {
      setErr(null);
      setMsg(`Pushed this environment to ${toEnv} (${otherBase}).`);
    },
    onError: (e: Error) => {
      if (e.message === "Push cancelled") return;
      setMsg(null);
      setErr(e.message);
    },
  });

  const removeBackup = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/system/backups/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.system.backups"] }),
  });

  const downloadStored = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ payload: unknown; createdAt: string }>(`/admin/system/backups/${id}`),
    onSuccess: (res) => {
      downloadJson(`patrol-log-backup-${res.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.json`, res.payload);
    },
  });

  function onUploadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        if (
          !confirm(
            "Restore will REPLACE all live data (members, residents, patrols, etc.) with this backup.\n\nStored backups are NOT deleted by seed, but this restore will wipe current operational data.\n\nContinue?",
          )
        ) {
          return;
        }
        restoreUpload.mutate(payload);
      } catch {
        setErr("Invalid backup JSON file.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="System backup"
        action={
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
            {health?.env ?? "…"} · {health?.name ?? "API"}
          </span>
        }
      />

      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        System admin only. Create a backup before seeding. Seed scripts wipe demo tables but{" "}
        <strong>never delete</strong> stored backups — you can restore from here afterwards.
      </p>

      {msg && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>}
      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
        <h3 className="mb-1 text-sm font-bold text-gray-900">Sync Cloudflare ↔ local</h3>
        <p className="mb-3 text-xs text-gray-600">
          Copies operational data between this API and another (Cloudflare Workers or local{" "}
          <code className="text-[11px]">wrangler dev</code>). <strong>system_backups</strong> are never wiped.
          Both sides must accept the same system_admin login.
        </p>
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <label className="text-xs text-gray-600 md:col-span-3">
            Other API URL
            <input
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={otherBase}
              onChange={(e) => setOtherBase(e.target.value)}
              placeholder="https://…workers.dev or http://localhost:8787"
            />
          </label>
          <label className="text-xs text-gray-600">
            System admin call sign
            <input
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm uppercase"
              value={syncCallSign}
              onChange={(e) => setSyncCallSign(e.target.value)}
            />
          </label>
          <label className="text-xs text-gray-600 md:col-span-2">
            Password (for the other API)
            <input
              type="password"
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={syncPassword}
              onChange={(e) => setSyncPassword(e.target.value)}
              placeholder="Admin1234!"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn
            disabled={syncPull.isPending || !syncPassword.trim()}
            onClick={() => syncPull.mutate()}
          >
            {syncPull.isPending ? "Pulling…" : "Pull other → this API"}
          </Btn>
          <Btn
            variant="danger"
            disabled={syncPush.isPending || !syncPassword.trim()}
            onClick={() => syncPush.mutate()}
          >
            {syncPush.isPending ? "Pushing…" : "Push this API → other"}
          </Btn>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          CLI alternative: <code>pnpm db:sync:pull</code> (Cloudflare→local) ·{" "}
          <code>pnpm db:sync:push -- --yes</code> (local→Cloudflare)
        </p>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-1 text-sm font-bold text-gray-900">Create backup</h3>
          <p className="mb-3 text-xs text-gray-500">
            Saves a seed-safe server copy (when size allows) and downloads the JSON file.
          </p>
          <input
            className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Optional label (e.g. before-seed)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Btn disabled={createBackup.isPending} onClick={() => createBackup.mutate()}>
            {createBackup.isPending ? "Backing up…" : "Backup now"}
          </Btn>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-1 text-sm font-bold text-gray-900">Export CSV pack</h3>
          <p className="mb-3 text-xs text-gray-500">
            Download every table as CSV plus import-friendly files for members, residents, vehicles, emergency services, and sectors.
          </p>
          <Btn disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
            {exportCsv.isPending ? "Exporting…" : "Download all CSV"}
          </Btn>
        </div>

        <div className="rounded-xl border bg-white p-4 md:col-span-2">
          <h3 className="mb-1 text-sm font-bold text-gray-900">Restore from file</h3>
          <p className="mb-3 text-xs text-gray-500">Upload a previously downloaded backup JSON.</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
              e.target.value = "";
            }}
          />
          <Btn
            disabled={restoreUpload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {restoreUpload.isPending ? "Restoring…" : "Choose backup file…"}
          </Btn>
        </div>
      </div>

      <h3 className="mb-2 text-sm font-bold text-gray-900">Stored backups (seed-safe)</h3>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data?.results.length ? (
        <p className="text-sm text-gray-400">No stored backups yet. Create one above.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.results.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{b.label || "—"}</td>
                  <td className="px-3 py-2 font-mono">{b.createdByCallSign}</td>
                  <td className="px-3 py-2">{formatBytes(b.byteSize)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-primary hover:underline"
                        onClick={() => downloadStored.mutate(b.id)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-amber-700 hover:underline"
                        disabled={restoreStored.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Restore backup from ${new Date(b.createdAt).toLocaleString()}?\n\nThis replaces all live operational data. Stored backups stay intact.`,
                            )
                          ) {
                            restoreStored.mutate(b.id);
                          }
                        }}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-600 hover:underline"
                        onClick={() => {
                          if (confirm("Delete this stored backup?")) removeBackup.mutate(b.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
