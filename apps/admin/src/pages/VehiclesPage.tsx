import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader, RowActions, StatusBadge } from "../components/DataTable";
import { Modal, Field, Btn, inputCls, selectCls } from "../components/Modal";
import { MultiSelect } from "../components/MultiSelect";
import { parseCsv, CsvImportButton, csvStamp } from "../components/CsvImport";

interface VehicleMember {
  id: string;
  callSign: string;
  name: string;
}

interface Vehicle {
  id: string;
  registration: string;
  description: string | null;
  lastOdometer: number;
  status: "available" | "maintenance" | "retired";
  patrollerId: string | null;
  patrollerIds?: string[];
  members?: VehicleMember[];
  memberCallSign: string | null;
  memberName: string | null;
  memberCallSigns?: string | null;
}

interface Member { id: string; callSign: string; name: string }

const STATUSES = ["available", "maintenance", "retired"] as const;

const EMPTY_ADD = {
  registration: "",
  description: "",
  last_odometer: 0,
  status: "available" as Vehicle["status"],
  patroller_ids: [] as string[],
};
const EMPTY_EDIT = {
  description: "",
  status: "available" as Vehicle["status"],
  last_odometer: 0,
  patroller_ids: [] as string[],
};

function memberIdsOf(r: Vehicle): string[] {
  if (r.patrollerIds?.length) return r.patrollerIds;
  if (r.members?.length) return r.members.map((m) => m.id);
  return r.patrollerId ? [r.patrollerId] : [];
}

function assignedLabel(r: Vehicle): string {
  if (r.members?.length) {
    return r.members.map((m) => m.callSign).join(", ");
  }
  if (r.memberCallSigns) return r.memberCallSigns.replace(/;\s*/g, ", ");
  return r.memberCallSign ?? "";
}

export function VehiclesPage({ embedded = false }: { embedded?: boolean }) {
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
  const memberOptions = members.map((m) => ({
    value: m.id,
    label: `${m.callSign} — ${m.name}`,
  }));

  const create = useMutation({
    mutationFn: (body: typeof EMPTY_ADD) =>
      adminFetch<Vehicle>("/admin/vehicles", {
        method: "POST",
        body: JSON.stringify({ ...body, patroller_ids: body.patroller_ids }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.vehicles"] }); setAddOpen(false); setAddForm(EMPTY_ADD); },
  });
  const update = useMutation({
    mutationFn: (body: typeof EMPTY_EDIT & { id: string }) =>
      adminFetch(`/admin/vehicles/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, patroller_ids: body.patroller_ids }),
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

  const rows = (data?.results ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.registration.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      assignedLabel(r).toLowerCase().includes(q) ||
      r.members?.some((m) => m.name.toLowerCase().includes(q) || m.callSign.toLowerCase().includes(q))
    );
  });

  function openEdit(r: Vehicle) {
    setEditRow(r);
    setEditForm({
      description: r.description ?? "",
      status: r.status,
      last_odometer: r.lastOdometer,
      patroller_ids: memberIdsOf(r),
    });
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows } = parseCsv(e.target?.result as string);
      if (!rows.length) { alert("No data rows found in CSV."); return; }
      if (!confirm(`Import ${rows.length} vehicles?\n\nExpected columns: registration, description, last_odometer, status, member_call_signs\n(Use ; or , between call signs for shared vehicles. member_call_sign still works.)`)) return;
      importMut.mutate(rows);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="Vehicles"
        hideTitle={embedded}
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex flex-wrap gap-2">
            <CsvImportButton
              onFile={handleImport}
              loading={importMut.isPending}
              exportCsv={{
                filename: `vehicles-${csvStamp()}.csv`,
                headers: ["registration", "description", "last_odometer", "status", "member_call_signs"],
                rows: rows.map((r) => [
                  r.registration,
                  r.description ?? "",
                  String(r.lastOdometer),
                  r.status,
                  r.members?.map((m) => m.callSign).join("; ")
                    ?? r.memberCallSigns
                    ?? r.memberCallSign
                    ?? "",
                ]),
              }}
              template={{
                filename: "vehicles-template.csv",
                headers: ["registration", "description", "last_odometer", "status", "member_call_signs"],
                example: ["JHB 123 GP", "White Toyota Hilux 2.8 GD-6", "45000", "available", "ALPHA1; ALPHA2"],
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
            {
              header: "Assigned to",
              render: (r) => {
                const list = r.members?.length
                  ? r.members
                  : r.memberCallSign
                    ? [{ id: r.patrollerId ?? "", callSign: r.memberCallSign, name: r.memberName ?? "" }]
                    : [];
                if (!list.length) return <span className="text-gray-400 text-xs">Unassigned</span>;
                return (
                  <div className="flex flex-col gap-0.5">
                    {list.map((m) => (
                      <span key={m.id || m.callSign}>
                        {m.callSign}
                        {m.name ? <span className="text-gray-400 text-xs"> — {m.name}</span> : null}
                      </span>
                    ))}
                  </div>
                );
              },
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
        <Field label="Assigned members">
          <MultiSelect
            options={memberOptions}
            value={addForm.patroller_ids}
            onChange={(patroller_ids) => setAddForm({ ...addForm, patroller_ids })}
            placeholder="— Unassigned —"
            emptyText="No members"
            searchable
          />
          <p className="mt-1 text-xs text-gray-500">Select more than one for shared vehicles (e.g. husband and wife).</p>
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
        <Field label="Assigned members">
          <MultiSelect
            options={memberOptions}
            value={editForm.patroller_ids}
            onChange={(patroller_ids) => setEditForm({ ...editForm, patroller_ids })}
            placeholder="— Unassigned —"
            emptyText="No members"
            searchable
          />
          <p className="mt-1 text-xs text-gray-500">Select more than one for shared vehicles (e.g. husband and wife).</p>
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
