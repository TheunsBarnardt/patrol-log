import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader, RowActions } from "../components/DataTable";
import { Modal, Field, Btn, inputCls } from "../components/Modal";

interface Sector {
  id: string;
  name: string;
  code: string | null;
  cpfId: string;
  createdAt: string;
  memberCount?: number;
}

const EMPTY = { name: "", code: "" };

export function SectorsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Sector | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.sectors"],
    queryFn: () => adminFetch<{ results: Sector[] }>("/admin/sectors"),
  });

  const create = useMutation({
    mutationFn: (body: typeof EMPTY) =>
      adminFetch<Sector>("/admin/sectors", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin.sectors"] });
      setAddOpen(false);
      setForm(EMPTY);
    },
  });

  const update = useMutation({
    mutationFn: (body: typeof EMPTY & { id: string }) =>
      adminFetch(`/admin/sectors/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: body.name, code: body.code || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin.sectors"] });
      setEditRow(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/sectors/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.sectors"] }),
  });

  const rows = (data?.results ?? []).filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.code ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function openEdit(r: Sector) {
    setEditRow(r);
    setForm({ name: r.name, code: r.code ?? "" });
  }

  return (
    <>
      <PageHeader
        title="Sectors"
        search={search}
        onSearch={setSearch}
        action={<Btn onClick={() => { setForm(EMPTY); setAddOpen(true); }}>+ Add sector</Btn>}
      />

      <p className="mb-4 max-w-2xl text-sm text-gray-600">
        Create and manage CPF sectors (e.g. WBS1, WBS2). Assign members to a sector from the Members page.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          keyExtractor={(r) => r.id}
          emptyMessage="No sectors yet. Add one to get started."
          columns={[
            {
              header: "Code",
              render: (r) => <span className="font-mono text-xs font-semibold">{r.code || "—"}</span>,
            },
            { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
            {
              header: "Members",
              render: (r) => <span className="tabular-nums text-gray-600">{r.memberCount ?? 0}</span>,
            },
            {
              header: "Created",
              render: (r) => (
                <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</span>
              ),
            },
            {
              header: "",
              className: "text-right",
              render: (r) => (
                <RowActions
                  onEdit={() => openEdit(r)}
                  onDelete={() => {
                    if (confirm(`Delete sector "${r.name}" (${r.code || "no code"})?\n\nMembers must be moved first.`)) {
                      remove.mutate(r.id, {
                        onError: (err) => {
                          alert(err instanceof Error ? err.message : "Could not delete sector");
                        },
                      });
                    }
                  }}
                />
              ),
            },
          ]}
        />
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add sector"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn disabled={create.isPending || !form.name.trim()} onClick={() => create.mutate(form)}>
              {create.isPending ? "Creating…" : "Create sector"}
            </Btn>
          </>
        }
      >
        {create.error instanceof Error && <p className="mb-3 text-sm text-red-600">{create.error.message}</p>}
        <Field label="Sector name" required>
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Waterberg Sector 4"
          />
        </Field>
        <Field label="Code">
          <input
            className={inputCls}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="e.g. WBS4"
          />
        </Field>
      </Modal>

      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title={`Edit ${editRow?.code || editRow?.name || "sector"}`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn
              disabled={update.isPending || !form.name.trim()}
              onClick={() => update.mutate({ id: editRow!.id, ...form })}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Btn>
          </>
        }
      >
        {update.error instanceof Error && <p className="mb-3 text-sm text-red-600">{update.error.message}</p>}
        <Field label="Sector name" required>
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Code">
          <input
            className={inputCls}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="e.g. WBS4"
          />
        </Field>
      </Modal>
    </>
  );
}
