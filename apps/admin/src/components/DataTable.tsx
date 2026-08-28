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
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  keyExtractor?: (row: T, index: number) => string | number;
  emptyMessage?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center text-gray-400 py-16 bg-white rounded-xl border border-dashed">
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto bg-white border rounded-xl shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr
              key={keyExtractor ? keyExtractor(row, i) : (row as { id?: string }).id ?? i}
              className={`${rowClassName?.(row) ?? "hover:bg-gray-50"} transition-colors`}
            >
              {columns.map((c, j) => (
                <td key={j} className={`px-4 py-3 ${c.className ?? ""}`}>
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

export function PageHeader({ title, action, search, onSearch }: {
  title: string;
  action?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <h1 className="shrink-0 text-lg font-bold text-gray-900">{title}</h1>
      {onSearch && (
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full max-w-xs rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />
      )}
      {action ? <div className="sm:ml-auto">{action}</div> : null}
    </div>
  );
}

export function DupHint({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return <>{children}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="rounded bg-amber-200 px-1.5 py-0.5 font-medium text-amber-950">{children}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800">duplicate</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    inactive: "bg-gray-100 text-gray-500",
    suspended: "bg-red-100 text-red-700",
    available: "bg-emerald-100 text-emerald-700",
    maintenance: "bg-yellow-100 text-yellow-700",
    retired: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

export function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {onEdit && (
        <button
          onClick={onEdit}
          className="text-xs font-medium text-gray-600 hover:text-brand-primary transition-colors px-2 py-1 rounded hover:bg-gray-100"
        >
          Edit
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
