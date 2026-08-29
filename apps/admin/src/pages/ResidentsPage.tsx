import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { DataTable, DupHint, PageHeader, RowActions } from "../components/DataTable";
import { Modal, Field, Btn, inputCls } from "../components/Modal";
import { parseCsv, CsvImportButton, csvStamp } from "../components/CsvImport";
import { duplicateIds, normalizeName, normalizePhone } from "../lib/duplicates";

interface Resident { id: string; name: string; phone: string; address: string; sectorId: string; cpfId: string }

const EMPTY = { name: "", phone: "", address: "" };

export function ResidentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Resident | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.residents"],
    queryFn: () => adminFetch<{ results: Resident[] }>("/admin/residents"),
  });

  const create = useMutation({
    mutationFn: (body: typeof EMPTY) => adminFetch<Resident>("/admin/residents", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.residents"] }); setAddOpen(false); setForm(EMPTY); },
  });
  const update = useMutation({
    mutationFn: (body: Partial<typeof EMPTY> & { id: string }) =>
      adminFetch(`/admin/residents/${body.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin.residents"] }); setEditRow(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/residents/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.residents"] }),
  });
  const importMut = useMutation({
    mutationFn: (rows: any[]) => adminFetch<{ imported: number; skipped: number; errors: string[] }>("/admin/residents/import", { method: "POST", body: JSON.stringify({ rows }) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin.residents"] });
      alert(`Import complete: ${res.imported} imported, ${res.skipped} skipped.${res.errors.length ? "\n\nErrors:\n" + res.errors.join("\n") : ""}`);
    },
  });

  const all = data?.results ?? [];
  const dupName = duplicateIds(all, (r) => r.id, (r) => normalizeName(r.name));
  const dupPhone = duplicateIds(all, (r) => r.id, (r) => normalizePhone(r.phone));
  const dupRows = new Set([...dupName, ...dupPhone]);

  const rows = all.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search),
  );

  function openEdit(r: Resident) {
    setEditRow(r);
    setForm({ name: r.name, phone: r.phone, address: r.address });
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows } = parseCsv(e.target?.result as string);
      // Expected columns: name, phone, address
      if (!rows.length) { alert("No data rows found in CSV."); return; }
      if (!confirm(`Import ${rows.length} residents?`)) return;
      importMut.mutate(rows);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="Residents"
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex flex-wrap gap-2">
            <CsvImportButton
              onFile={handleImport}
              loading={importMut.isPending}
              exportCsv={{
                filename: `residents-${csvStamp()}.csv`,
                headers: ["name", "phone", "address"],
                rows: rows.map((r) => [r.name, r.phone, r.address]),
              }}
              template={{
                filename: "residents-template.csv",
                headers: ["name", "phone", "address"],
                example: ["Jane Doe", "+27 82 123 4567", "12 Oak Street, Pretoria, 0001"],
              }}
            />
            <Btn onClick={() => { setForm(EMPTY); setAddOpen(true); }}>+ Add resident</Btn>
          </div>
        }
      />

      {dupRows.size > 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {dupRows.size} resident{dupRows.size === 1 ? "" : "s"} highlighted — same name or phone as another record.
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
              header: "Name",
              render: (r) => (
                <DupHint show={dupName.has(r.id)}>
                  <span className="font-medium">{r.name}</span>
                </DupHint>
              ),
            },
            {
              header: "Phone",
              render: (r) => <DupHint show={dupPhone.has(r.id)}>{r.phone}</DupHint>,
            },
            { header: "Address", render: (r) => <span className="text-gray-500">{r.address}</span> },
            {
              header: "", className: "text-right",
              render: (r) => <RowActions onEdit={() => openEdit(r)} onDelete={() => { if (confirm(`Delete ${r.name}?`)) remove.mutate(r.id); }} />,
            },
          ]}
        />
      )}

      {/* Add modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add resident"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn disabled={create.isPending} onClick={() => create.mutate(form)}>
              {create.isPending ? "Saving…" : "Add resident"}
            </Btn>
          </>
        }
      >
        <ResidentForm form={form} onChange={setForm} />
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title="Edit resident"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn disabled={update.isPending} onClick={() => update.mutate({ id: editRow!.id, ...form })}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Btn>
          </>
        }
      >
        <ResidentForm form={form} onChange={setForm} />
      </Modal>
    </>
  );
}

function ResidentForm({ form, onChange }: { form: { name: string; phone: string; address: string }; onChange: (f: any) => void }) {
  return (
    <>
      <Field label="Full name" required>
        <input className={inputCls} value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} required />
      </Field>
      <Field label="Phone" required>
        <input className={inputCls} value={form.phone} onChange={(e) => onChange({ ...form, phone: e.target.value })} required />
      </Field>
      <Field label="Address">
        <input className={inputCls} value={form.address} onChange={(e) => onChange({ ...form, address: e.target.value })} />
      </Field>
    </>
  );
}
