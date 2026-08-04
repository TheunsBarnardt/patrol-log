import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  keyExtractor,
  emptyMessage = "No records",
}: {
  rows: T[];
  columns: Column<T>[];
  keyExtractor?: (row: T, index: number) => string | number;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-white/80 py-16 text-center">
        <p className="text-sm text-brand-muted">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="-mx-1 overflow-auto rounded-2xl border border-brand-line bg-white shadow-card sm:mx-0">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-brand-line bg-brand-primarySoft/50">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-brand-muted ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-line/70">
          {rows.map((row, i) => (
            <tr
              key={keyExtractor ? keyExtractor(row, i) : (row as { id?: string }).id ?? i}
              className="transition-colors hover:bg-brand-primarySoft/40"
            >
              {columns.map((c, j) => (
                <td key={j} className={`px-4 py-3 text-brand-ink ${c.className ?? ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  action,
  search,
  onSearch,
}: {
  title: string;
  action?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-brand-ink sm:text-2xl">{title}</h1>
        <div className="brand-stripe mt-2 h-1 w-14 rounded-full" />
      </div>
      {onSearch && (
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full border border-brand-line bg-white px-3 py-2.5 text-sm shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25 sm:max-w-xs rounded-xl"
        />
      )}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{action}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-brand-greenSoft text-brand-green",
    inactive: "bg-slate-100 text-slate-500",
    suspended: "bg-red-100 text-brand-accent",
    available: "bg-brand-greenSoft text-brand-green",
    maintenance: "bg-amber-100 text-amber-800",
    retired: "bg-slate-100 text-slate-500",
    stood_down: "bg-brand-primarySoft text-brand-primary",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${map[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {onEdit && (
        <button
          onClick={onEdit}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primarySoft"
        >
          Edit
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-accent transition-colors hover:bg-red-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
