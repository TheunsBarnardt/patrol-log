import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseSqliteUtc } from "@patrol-log/shared";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader, RowActions } from "../components/DataTable";
import { Modal, Field, Btn, inputCls, selectCls } from "../components/Modal";
import { parseCsv, CsvImportButton } from "../components/CsvImport";

const SERVICE_TYPES = [
  "police", "ambulance", "fire", "armed_response", "hospital", "ops_room", "vet", "tow", "poison_control", "other",
] as const;
type ServiceType = typeof SERVICE_TYPES[number];

interface Service {
  id: string; name: string; serviceType: ServiceType;
  primaryNumber: string; secondaryNumber: string | null;
  address: string | null; priority: number; sensitive: boolean; verifiedAt: string;
}

const EMPTY = { name: "", service_type: "police" as ServiceType, primary_number: "", secondary_number: "", address: "", priority: 100, sensitive: false };

export function EmergencyServicesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Service | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.emergency-services"],
    queryFn: () => adminFetch<{ results: Service[] }>("/admin/emergency-services"),
  });

  const create = useMutation({
    mutationFn: (body: typeof EMPTY) => adminFetch<Service>("/admin/emergency-services", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.emergency-services"] }); setAddOpen(false); setForm(EMPTY); },
  });
  const update = useMutation({
    mutationFn: (body: Partial<typeof EMPTY> & { id: string }) =>
      adminFetch(`/admin/emergency-services/${body.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.emergency-services"] }); setEditRow(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/emergency-services/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.emergency-services"] }),
  });
  const importMut = useMutation({
    mutationFn: (rows: any[]) => adminFetch<{ imported: number; skipped: number; errors: string[] }>("/admin/emergency-services/import", { method: "POST", body: JSON.stringify({ rows }) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin.emergency-services"] });
      alert(`Import complete: ${res.imported} imported, ${res.skipped} skipped.${res.errors.length ? "\n\nErrors:\n" + res.errors.join("\n") : ""}`);
    },
  });

  const rows = (data?.results ?? []).filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.serviceType.includes(search.toLowerCase()),
  );

  function openEdit(r: Service) {
    setEditRow(r);
    setForm({
      name: r.name, service_type: r.serviceType, primary_number: r.primaryNumber,
      secondary_number: r.secondaryNumber ?? "", address: r.address ?? "",
      priority: r.priority, sensitive: r.sensitive,
    });
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows } = parseCsv(e.target?.result as string);
      if (!rows.length) { alert("No data rows found in CSV."); return; }
      if (!confirm(`Import ${rows.length} emergency services?\n\nExpected columns: name, service_type, primary_number, secondary_number, address, priority, sensitive`)) return;
      importMut.mutate(rows);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="Emergency services"
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex gap-2">
            <CsvImportButton
              onFile={handleImport}
              loading={importMut.isPending}
              template={{
                filename: "emergency-services-template.csv",
                headers: ["name", "service_type", "primary_number", "secondary_number", "address", "priority", "sensitive"],
                example: ["Pretoria Central Police", "police", "10111", "+27 12 358 7000", "Pretorius St, Pretoria, 0001", "10", "false"],
              }}
            />
            <Btn onClick={() => { setForm(EMPTY); setAddOpen(true); }}>+ Add service</Btn>
          </div>
        }
      />

      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <DataTable
          rows={rows}
          keyExtractor={(r) => r.id}
          columns={[
            { header: "Priority", render: (r) => <span className="font-mono text-xs">{r.priority}</span> },
            { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
            { header: "Type", render: (r) => <span className="capitalize text-xs text-gray-500">{r.serviceType.replace(/_/g, " ")}</span> },
            { header: "Primary", render: (r) => r.primaryNumber },
            { header: "Secondary", render: (r) => r.secondaryNumber ?? <span className="text-gray-400">—</span> },
            { header: "Verified", render: (r) => {
              const verified = parseSqliteUtc(r.verifiedAt) ?? new Date(r.verifiedAt);
              const stale = Date.now() - verified.getTime() > 90 * 24 * 60 * 60 * 1000;
              return <span className={stale ? "text-amber-600 text-xs font-semibold" : "text-xs text-gray-500"}>{stale ? "⚠ " : ""}{verified.toLocaleDateString()}</span>;
            }},
            { header: "", className: "text-right", render: (r) => <RowActions onEdit={() => openEdit(r)} onDelete={() => { if (confirm(`Delete ${r.name}?`)) remove.mutate(r.id); }} /> },
          ]}
        />
      )}

      <ServiceFormModal open={addOpen} onClose={() => setAddOpen(false)} title="Add emergency service" form={form} onChange={setForm}
        footer={<><Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn><Btn disabled={create.isPending} onClick={() => create.mutate(form)}>{create.isPending ? "Saving…" : "Add service"}</Btn></>}
      />
      <ServiceFormModal open={!!editRow} onClose={() => setEditRow(null)} title={`Edit ${editRow?.name}`} form={form} onChange={setForm}
        footer={<><Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn><Btn disabled={update.isPending} onClick={() => update.mutate({ id: editRow!.id, ...form })}>{update.isPending ? "Saving…" : "Save changes"}</Btn></>}
      />
    </>
  );
}

function ServiceFormModal({ open, onClose, title, form, onChange, footer }: any) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={footer}>
      <div className="grid grid-cols-2 gap-x-4">
        <div className="col-span-2"><Field label="Name" required><input className={inputCls} value={form.name} onChange={(e: any) => onChange({ ...form, name: e.target.value })} required /></Field></div>
        <Field label="Type">
          <select className={selectCls} value={form.service_type} onChange={(e: any) => onChange({ ...form, service_type: e.target.value })}>
            {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <input className={inputCls} type="number" value={form.priority} onChange={(e: any) => onChange({ ...form, priority: Number(e.target.value) })} />
        </Field>
        <Field label="Primary number" required><input className={inputCls} value={form.primary_number} onChange={(e: any) => onChange({ ...form, primary_number: e.target.value })} required /></Field>
        <Field label="Secondary number"><input className={inputCls} value={form.secondary_number} onChange={(e: any) => onChange({ ...form, secondary_number: e.target.value })} /></Field>
        <div className="col-span-2"><Field label="Address"><input className={inputCls} value={form.address} onChange={(e: any) => onChange({ ...form, address: e.target.value })} /></Field></div>
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.sensitive} onChange={(e: any) => onChange({ ...form, sensitive: e.target.checked })} className="rounded" />
            <span>Sensitive — hidden from dispatch view</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
