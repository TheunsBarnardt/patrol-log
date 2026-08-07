import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, authStore } from "../lib/api";
import { DataTable, PageHeader, RowActions } from "../components/DataTable";
import { Modal, Field, Btn, inputCls, selectCls } from "../components/Modal";

type PatrolType = "foot" | "vehicle" | "static" | "sector_monitoring" | "ops" | "responding";
type PatrolState = "active" | "stood_down";
type PatrolReason = "shift_end" | "emergency" | "vehicle_issue" | "personal";

interface Patrol {
  id: string;
  primaryPatrollerId: string;
  primaryCallSign?: string | null;
  primaryName?: string | null;
  patrolType: PatrolType;
  state: PatrolState;
  startTime: string;
  endTime: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceKm: number | null;
  vehicleId: string | null;
  reason: PatrolReason | null;
  sarsPurpose: string;
  sarsCompliant: boolean;
  recordSealHash: string | null;
}

const TYPES: { value: PatrolType; label: string }[] = [
  { value: "foot", label: "Foot" },
  { value: "vehicle", label: "Vehicle" },
  { value: "static", label: "Static" },
  { value: "sector_monitoring", label: "Sector monitoring" },
  { value: "ops", label: "OPS" },
  { value: "responding", label: "Responding" },
];

const REASONS: { value: PatrolReason | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "shift_end", label: "Shift end" },
  { value: "emergency", label: "Emergency" },
  { value: "vehicle_issue", label: "Vehicle issue" },
  { value: "personal", label: "Personal" },
];

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function PatrolsPage() {
  const qc = useQueryClient();
  const isSysAdmin = authStore.getProfile()?.access_level === "system_admin";
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<Patrol | null>(null);
  const [form, setForm] = useState({
    patrol_type: "foot" as PatrolType,
    state: "stood_down" as PatrolState,
    start_time: "",
    end_time: "",
    odometer_start: "" as string | number,
    odometer_end: "" as string | number,
    distance_km: "" as string | number,
    reason: "" as PatrolReason | "",
    sars_purpose: "",
    sars_compliant: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin.patrols"],
    queryFn: () => adminFetch<{ results: Patrol[] }>("/admin/patrols"),
  });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown> & { id: string }) =>
      adminFetch(`/admin/patrols/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin.patrols"] });
      setEditRow(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/patrols/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.patrols"] }),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.results ?? []).filter((r) => {
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.patrolType.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q) ||
        (r.primaryCallSign ?? "").toLowerCase().includes(q) ||
        (r.primaryName ?? "").toLowerCase().includes(q)
      );
    });
  }, [data?.results, search]);

  function openEdit(r: Patrol) {
    setEditRow(r);
    setForm({
      patrol_type: r.patrolType,
      state: r.state,
      start_time: toLocalInput(r.startTime),
      end_time: toLocalInput(r.endTime),
      odometer_start: r.odometerStart ?? "",
      odometer_end: r.odometerEnd ?? "",
      distance_km: r.distanceKm ?? "",
      reason: r.reason ?? "",
      sars_purpose: r.sarsPurpose ?? "",
      sars_compliant: r.sarsCompliant,
    });
  }

  function saveEdit() {
    if (!editRow) return;
    const start = fromLocalInput(form.start_time);
    if (!start) {
      alert("Start time is required");
      return;
    }
    update.mutate({
      id: editRow.id,
      patrol_type: form.patrol_type,
      state: form.state,
      start_time: start,
      end_time: fromLocalInput(form.end_time),
      odometer_start: form.odometer_start === "" ? null : Number(form.odometer_start),
      odometer_end: form.odometer_end === "" ? null : Number(form.odometer_end),
      distance_km: form.distance_km === "" ? null : Number(form.distance_km),
      reason: form.reason || null,
      sars_purpose: form.sars_purpose,
      sars_compliant: form.sars_compliant,
    });
  }

  return (
    <>
      <PageHeader title="Patrols" search={search} onSearch={setSearch} />

      {isSysAdmin && (
        <p className="mb-4 max-w-2xl text-sm text-gray-600">
          As system admin you can edit patrol records and permanently delete captured (stood-down) or stuck active patrols.
          Editing clears the record seal.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          keyExtractor={(r) => r.id}
          columns={[
            {
              header: "Primary",
              render: (r) => (
                <div>
                  <div className="font-semibold text-gray-900">{r.primaryCallSign ?? "—"}</div>
                  <div className="text-xs text-gray-500">{r.primaryName ?? r.primaryPatrollerId.slice(0, 8)}</div>
                </div>
              ),
            },
            { header: "Type", render: (r) => r.patrolType.replace(/_/g, " ") },
            {
              header: "State",
              render: (r) => (
                <span
                  className={`text-xs font-bold uppercase ${
                    r.state === "active" ? "text-emerald-700" : "text-gray-500"
                  }`}
                >
                  {r.state === "stood_down" ? "captured" : r.state}
                </span>
              ),
            },
            { header: "Start", render: (r) => new Date(r.startTime).toLocaleString() },
            { header: "End", render: (r) => (r.endTime ? new Date(r.endTime).toLocaleString() : "—") },
            {
              header: "Distance",
              render: (r) => (r.distanceKm != null ? `${r.distanceKm} km` : "—"),
            },
            {
              header: "SARS",
              render: (r) =>
                r.sarsCompliant ? (
                  <span className="font-bold text-emerald-700">✓</span>
                ) : (
                  <span className="font-bold text-brand-warning">!</span>
                ),
            },
            {
              header: "Seal",
              render: (r) =>
                r.recordSealHash ? (
                  <span className="font-mono text-xs text-gray-500">{r.recordSealHash.slice(0, 10)}…</span>
                ) : (
                  "—"
                ),
            },
            ...(isSysAdmin
              ? [
                  {
                    header: "",
                    className: "text-right",
                    render: (r: Patrol) => (
                      <RowActions
                        onEdit={() => openEdit(r)}
                        onDelete={() => {
                          const label = r.primaryCallSign ?? r.id.slice(0, 8);
                          if (
                            confirm(
                              `Permanently delete patrol ${label} (${r.state === "stood_down" ? "captured" : "active"})?\n\nThis cannot be undone.`,
                            )
                          ) {
                            remove.mutate(r.id);
                          }
                        }}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title={`Edit patrol ${editRow?.primaryCallSign ?? editRow?.id.slice(0, 8) ?? ""}`}
        size="lg"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditRow(null)}>
              Cancel
            </Btn>
            <Btn disabled={update.isPending} onClick={saveEdit}>
              {update.isPending ? "Saving…" : "Save"}
            </Btn>
          </>
        }
      >
        {update.error instanceof Error && (
          <p className="mb-3 text-sm text-red-600">{update.error.message}</p>
        )}
        {editRow?.recordSealHash && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This patrol is sealed. Saving will clear the seal hash.
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Type" required>
            <select
              className={selectCls}
              value={form.patrol_type}
              onChange={(e) => setForm({ ...form, patrol_type: e.target.value as PatrolType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="State" required>
            <select
              className={selectCls}
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value as PatrolState })}
            >
              <option value="active">Active</option>
              <option value="stood_down">Captured (stood down)</option>
            </select>
          </Field>
          <Field label="Start" required>
            <input
              className={inputCls}
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </Field>
          <Field label="End">
            <input
              className={inputCls}
              type="datetime-local"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </Field>
          <Field label="Odometer start">
            <input
              className={inputCls}
              type="number"
              min={0}
              value={form.odometer_start}
              onChange={(e) => setForm({ ...form, odometer_start: e.target.value })}
            />
          </Field>
          <Field label="Odometer end">
            <input
              className={inputCls}
              type="number"
              min={0}
              value={form.odometer_end}
              onChange={(e) => setForm({ ...form, odometer_end: e.target.value })}
            />
          </Field>
          <Field label="Distance (km)">
            <input
              className={inputCls}
              type="number"
              min={0}
              value={form.distance_km}
              onChange={(e) => setForm({ ...form, distance_km: e.target.value })}
            />
          </Field>
          <Field label="Stand-down reason">
            <select
              className={selectCls}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value as PatrolReason | "" })}
            >
              {REASONS.map((r) => (
                <option key={r.value || "none"} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="SARS purpose">
              <input
                className={inputCls}
                value={form.sars_purpose}
                onChange={(e) => setForm({ ...form, sars_purpose: e.target.value })}
              />
            </Field>
          </div>
          <div className="col-span-2 mb-2 flex items-center gap-2">
            <input
              id="sars_compliant"
              type="checkbox"
              checked={form.sars_compliant}
              onChange={(e) => setForm({ ...form, sars_compliant: e.target.checked })}
            />
            <label htmlFor="sars_compliant" className="text-sm text-gray-700">
              SARS compliant
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}
