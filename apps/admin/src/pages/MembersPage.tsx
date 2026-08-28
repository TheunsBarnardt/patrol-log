import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, authStore } from "../lib/api";
import { DataTable, DupHint, PageHeader, RowActions, StatusBadge } from "../components/DataTable";
import { Modal, Field, Btn, inputCls, selectCls } from "../components/Modal";
import { parseCsv, CsvImportButton } from "../components/CsvImport";
import { duplicateIds, normalizeName, normalizePhone } from "../lib/duplicates";

interface Member {
  id: string; callSign: string; name: string; phone: string | null; address: string | null;
  sectorId: string;
  sectorCode?: string | null;
  sectorName?: string | null;
  accessLevel: "call_centre_agent" | "patroller" | "sector_lead" | "admin" | "system_admin";
  status: "active" | "inactive" | "suspended";
}

interface SectorOption {
  id: string;
  name: string;
  code: string | null;
}

const ACCESS_LEVELS = [
  { value: "patroller", label: "Patroller" },
  { value: "call_centre_agent", label: "Call centre agent" },
  { value: "sector_lead", label: "Sector lead" },
  { value: "admin", label: "Admin (sector)" },
  { value: "system_admin", label: "System admin (all sectors)" },
] as const;

const STATUSES = ["active", "inactive", "suspended"] as const;

const EMPTY_ADD = {
  call_sign: "",
  name: "",
  phone: "",
  address: "",
  password: "",
  access_level: "patroller" as Member["accessLevel"],
  sector_id: "",
};
const EMPTY_EDIT = {
  call_sign: "",
  name: "",
  phone: "",
  address: "",
  status: "active" as Member["status"],
  access_level: "patroller" as Member["accessLevel"],
  password: "",
  sector_id: "",
};

export function MembersPage() {
  const qc = useQueryClient();
  const isSysAdmin = authStore.getProfile()?.access_level === "system_admin";
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Member | null>(null);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.members"],
    queryFn: () => adminFetch<{ results: Member[] }>("/admin/members"),
  });
  const { data: sectorsData } = useQuery({
    queryKey: ["admin.sectors"],
    queryFn: () => adminFetch<{ results: SectorOption[] }>("/admin/sectors"),
    retry: false,
  });
  const sectors = sectorsData?.results ?? [];
  const sectorLabel = (r: Member) => {
    if (r.sectorCode || r.sectorName) return r.sectorCode || r.sectorName || "—";
    const s = sectors.find((x) => x.id === r.sectorId);
    return s ? s.code || s.name : "—";
  };

  const create = useMutation({
    mutationFn: (body: typeof EMPTY_ADD) =>
      adminFetch<Member>("/admin/members", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          sector_id: body.sector_id || undefined,
        }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.members"] }); setAddOpen(false); setAddForm(EMPTY_ADD); },
  });
  const update = useMutation({
    mutationFn: (body: typeof EMPTY_EDIT & { id: string }) => {
      const payload: Record<string, unknown> = {
        name: body.name,
        phone: body.phone,
        address: body.address,
        status: body.status,
        access_level: body.access_level,
        sector_id: body.sector_id || undefined,
      };
      if (body.password) payload.password = body.password;
      if (isSysAdmin && body.call_sign.trim()) payload.call_sign = body.call_sign.trim().toUpperCase();
      return adminFetch(`/admin/members/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.members"] }); setEditRow(null); },
  });
  const importMut = useMutation({
    mutationFn: (rows: any[]) => adminFetch<{ imported: number; skipped: number; errors: string[] }>("/admin/members/import", { method: "POST", body: JSON.stringify({ rows }) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin.members"] });
      const note = res.skipped ? `\n\nNote: ${res.skipped} rows skipped (duplicates or invalid).` : "";
      const errs = res.errors.length ? "\n\nDetails:\n" + res.errors.slice(0, 10).join("\n") : "";
      alert(`Import complete: ${res.imported} members created.${note}${errs}\n\nDefault password for rows without a password column: Change@Me1`);
    },
  });

  const all = data?.results ?? [];
  const dupCallSign = duplicateIds(all, (r) => r.id, (r) => r.callSign.trim().toUpperCase());
  const dupName = duplicateIds(all, (r) => r.id, (r) => normalizeName(r.name));
  const dupPhone = duplicateIds(all, (r) => r.id, (r) => normalizePhone(r.phone));
  const dupRows = new Set([...dupCallSign, ...dupName, ...dupPhone]);

  const rows = all.filter((r) =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.callSign.toLowerCase().includes(search.toLowerCase()),
  );

  function openEdit(r: Member) {
    setEditRow(r);
    setEditForm({
      call_sign: r.callSign,
      name: r.name,
      phone: r.phone ?? "",
      address: r.address ?? "",
      status: r.status,
      access_level: r.accessLevel,
      password: "",
      sector_id: r.sectorId,
    });
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows } = parseCsv(e.target?.result as string);
      if (!rows.length) { alert("No data rows found in CSV."); return; }
      if (!confirm(`Import ${rows.length} members?\n\nExpected columns: call_sign, name, phone, address, access_level, password\nRows without a password will get default password: Change@Me1`)) return;
      importMut.mutate(rows);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="Members"
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex gap-2">
            <CsvImportButton
              onFile={handleImport}
              loading={importMut.isPending}
              template={{
                filename: "members-template.csv",
                headers: ["call_sign", "name", "phone", "address", "access_level", "password"],
                example: ["ALPHA1", "John Smith", "+27 83 987 6543", "5 Park Ave, Johannesburg, 2001", "patroller", "SecurePass@1"],
              }}
            />
            <Btn onClick={() => { setAddForm(EMPTY_ADD); setAddOpen(true); }}>+ Add member</Btn>
          </div>
        }
      />

      {dupRows.size > 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {dupRows.size} member{dupRows.size === 1 ? "" : "s"} highlighted — same call sign, name, or phone as another record.
        </p>
      )}

      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <DataTable
          rows={rows}
          keyExtractor={(r) => r.id}
          rowClassName={(r) =>
            dupRows.has(r.id) ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50"
          }
          columns={[
            {
              header: "Call sign",
              render: (r) => (
                <DupHint show={dupCallSign.has(r.id)}>
                  <span className="font-mono font-bold">{r.callSign}</span>
                </DupHint>
              ),
            },
            {
              header: "Name",
              render: (r) => (
                <DupHint show={dupName.has(r.id)}>
                  <span className="font-medium">{r.name}</span>
                </DupHint>
              ),
            },
            { header: "Sector", render: (r) => <span className="font-mono text-xs">{sectorLabel(r)}</span> },
            {
              header: "Phone",
              render: (r) => <DupHint show={dupPhone.has(r.id)}>{r.phone ?? "—"}</DupHint>,
            },
            { header: "Access", render: (r) => <span className="capitalize text-xs">{r.accessLevel.replace(/_/g, " ")}</span> },
            { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { header: "", className: "text-right", render: (r) => <RowActions onEdit={() => openEdit(r)} /> },
          ]}
        />
      )}

      {/* Add modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add member"
        size="lg"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn disabled={create.isPending} onClick={() => create.mutate(addForm)}>
              {create.isPending ? "Creating…" : "Create member"}
            </Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Call sign" required>
            <input className={`${inputCls} uppercase`} value={addForm.call_sign} onChange={(e) => setAddForm({ ...addForm, call_sign: e.target.value })} required />
          </Field>
          <Field label="Access level" required>
            <select className={selectCls} value={addForm.access_level} onChange={(e) => setAddForm({ ...addForm, access_level: e.target.value as Member["accessLevel"] })}>
              {ACCESS_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Full name" required>
            <input className={inputCls} value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} required />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} />
          </Field>
          {sectors.length > 0 && (
            <div className="col-span-2">
              <Field label="Sector">
                <select
                  className={selectCls}
                  value={addForm.sector_id}
                  onChange={(e) => setAddForm({ ...addForm, sector_id: e.target.value })}
                >
                  <option value="">My sector (default)</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>{s.code || s.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="col-span-2">
            <Field label="Address">
              <input className={inputCls} value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Initial password" required>
              <input className={inputCls} type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} required />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title={`Edit ${editRow?.callSign}`}
        size="lg"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn disabled={update.isPending} onClick={() => update.mutate({ id: editRow!.id, ...editForm })}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Btn>
          </>
        }
      >
        {update.error instanceof Error && (
          <p className="mb-3 text-sm text-red-600">{update.error.message}</p>
        )}
        <div className="grid grid-cols-2 gap-x-4">
          {isSysAdmin ? (
            <Field label="Call sign" required>
              <input
                className={`${inputCls} uppercase`}
                value={editForm.call_sign}
                onChange={(e) => setEditForm({ ...editForm, call_sign: e.target.value.toUpperCase() })}
              />
            </Field>
          ) : (
            <Field label="Call sign">
              <input className={`${inputCls} uppercase bg-gray-50`} value={editForm.call_sign} disabled readOnly />
            </Field>
          )}
          <Field label="Full name" required>
            <input className={inputCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          </Field>
          <Field label="Access level">
            <select className={selectCls} value={editForm.access_level} onChange={(e) => setEditForm({ ...editForm, access_level: e.target.value as Member["accessLevel"] })}>
              {ACCESS_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={selectCls} value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Member["status"] })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {sectors.length > 0 && (
            <div className="col-span-2">
              <Field label="Sector">
                <select
                  className={selectCls}
                  value={editForm.sector_id}
                  onChange={(e) => setEditForm({ ...editForm, sector_id: e.target.value })}
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>{s.code || s.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="col-span-2">
            <Field label="Address">
              <input className={inputCls} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="New password (leave blank to keep current)">
              <input className={inputCls} type="password" placeholder="••••••••" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
