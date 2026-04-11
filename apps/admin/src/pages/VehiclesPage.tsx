import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader, RowActions, StatusBadge } from "../components/DataTable";
import { Modal, Field, Btn, inputCls, selectCls } from "../components/Modal";
import { parseCsv, CsvImportButton } from "../components/CsvImport";

interface Vehicle {
  id: string;
  registration: string;
  description: string | null;
  lastOdometer: number;
  status: "available" | "maintenance" | "retired";
  patrollerId: string | null;
  memberCallSign: string | null;
  memberName: string | null;
}

interface Member { id: string; callSign: string; name: string }

const STATUSES = ["available", "maintenance", "retired"] as const;

const EMPTY_ADD = { registration: "", description: "", last_odometer: 0, status: "available" as Vehicle["status"], patroller_id: "" };
const EMPTY_EDIT = { description: "", status: "available" as Vehicle["status"], last_odometer: 0, patroller_id: "" };

export function VehiclesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Vehicle | null>(null);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.vehicles"],
    queryFn: () => adminFetch<{ results: Vehicle[] }>("/admin/vehicles"),
  });
  const { data: membersData } = useQuery({
    queryKey: ["admin.members"],
    queryFn: () => adminFetch<{ results: Member[] }>("/admin/members"),
  });
  const members: Member[] = membersData?.results ?? [];

  const create = useMutation({
    mutationFn: (body: typeof EMPTY_ADD) =>
      adminFetch<Vehicle>("/admin/vehicles", {
        method: "POST",
        body: JSON.stringify({ ...body, patroller_id: body.patroller_id || null }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.vehicles"] }); setAddOpen(false); setAddForm(EMPTY_ADD); },
  });
  const update = useMutation({
    mutationFn: (body: typeof EMPTY_EDIT & { id: string }) =>
      adminFetch(`/admin/vehicles/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, patroller_id: body.patroller_id || null }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.vehicles"] }); setEditRow(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/vehicles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.vehicles"] }),
  });
  const importMut = useMutation({
    mutationFn: (rows: any[]) =>
      adminFetch<{ imported: number; skipped: number; errors: string[] }>("/admin/vehicles/import", {
        method: "POST",
        body: JSON.stringify({ rows }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin.vehicles"] });
      alert(`Import complete: ${res.imported} imported, ${res.skipped} skipped.${res.errors.length ? "\n\nErrors:\n" + res.errors.slice(0, 10).join("\n") : ""}`);
    },
  });

  const rows = (data?.results ?? []).filter((r) =>
    !search ||
    r.registration.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase()) ||
    r.memberCallSign?.toLowerCase().includes(search.toLowerCase()) ||
    r.memberName?.toLowerCase().includes(search.toLowerCase()),
  );

  function openEdit(r: Vehicle) {
    setEditRow(r);
    setEditForm({
      description: r.description ?? "",
      status: r.status,
      last_odometer: r.lastOdometer,
      patroller_id: r.patrollerId ?? "",
    });
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows } = parseCsv(e.target?.result as string);
      if (!rows.length) { alert("No data rows found in CSV."); return; }
      if (!confirm(`Import ${rows.length} vehicles?\n\nExpected columns: registration, description, last_odometer, status, member_call_sign`)) return;
      importMut.mutate(rows);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="Vehicles"
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex gap-2">
            <CsvImportButton
              onFile={handleImport}
              loading={importMut.isPending}
              template={{
                filename: "vehicles-template.csv",
                headers: ["registration", "description", "last_odometer", "status", "member_call_sign"],
                example: ["JHB 123 GP", "White Toyota Hilux 2.8 GD-6", "45000", "available", "ALPHA1"],
              }}
            />
            <Btn onClick={() => { setAddForm(EMPTY_ADD); setAddOpen(true); }}>+ Add vehicle</Btn>
          </div>
        }
      />

      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <DataTable
          rows={rows}
          keyExtractor={(r) => r.id}
          columns={[
            { header: "Registration", render: (r) => <span className="font-mono font-bold">{r.registration}</span> },
            { header: "Description", render: (r) => r.description ?? <span className="text-gray-400">—</span> },
            { header: "Assigned to", render: (r) => r.memberCallSign
              ? <span>{r.memberCallSign} <span className="text-gray-400 text-xs">— {r.memberName}</span></span>
              : <span className="text-gray-400 text-xs">Unassigned</span>
            },
            { header: "Odometer", render: (r) => `${r.lastOdometer.toLocaleString()} km` },
            { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            {
              header: "", className: "text-right",
              render: (r) => <RowActions onEdit={() => openEdit(r)} onDelete={() => { if (confirm(`Delete vehicle ${r.registration}?`)) remove.mutate(r.id); }} />,
            },
          ]}
        />
      )}

      {/* Add modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add vehicle"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn disabled={create.isPending} onClick={() => create.mutate(addForm)}>
              {create.isPending ? "Saving…" : "Add vehicle"}
            </Btn>
          </>
        }
      >
        <Field label="Registration" required>
          <input className={`${inputCls} uppercase`} value={addForm.registration} onChange={(e) => setAddForm({ ...addForm, registration: e.target.value })} required />
        </Field>
        <Field label="Description">
          <input className={inputCls} placeholder="e.g. White Toyota Hilux" value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
        </Field>
        <Field label="Assigned member">
          <select
            className={selectCls}
            value={addForm.patroller_id}
            onChange={(e) => setAddForm({ ...addForm, patroller_id: e.target.value })}
          >
            <option value="">— Unassigned —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.callSign} — {m.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Current odometer (km)">
          <input className={inputCls} type="number" min={0} value={addForm.last_odometer} onChange={(e) => setAddForm({ ...addForm, last_odometer: Number(e.target.value) })} />
        </Field>
        <Field label="Status">
          <select className={selectCls} value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value as Vehicle["status"] })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title={`Edit ${editRow?.registration}`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn disabled={update.isPending} onClick={() => update.mutate({ id: editRow!.id, ...editForm })}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Btn>
          </>
        }
      >
        <Field label="Description">
          <input className={inputCls} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
        </Field>
        <Field label="Assigned member">
          <select
            className={selectCls}
            value={editForm.patroller_id}
            onChange={(e) => setEditForm({ ...editForm, patroller_id: e.target.value })}
          >
            <option value="">— Unassigned —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.callSign} — {m.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Current odometer (km)">
          <input className={inputCls} type="number" min={0} value={editForm.last_odometer} onChange={(e) => setEditForm({ ...editForm, last_odometer: Number(e.target.value) })} />
        </Field>
        <Field label="Status">
          <select className={selectCls} value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Vehicle["status"] })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </Modal>
    </>
  );
}
