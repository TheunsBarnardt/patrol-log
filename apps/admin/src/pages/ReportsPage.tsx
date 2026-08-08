import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PatrolDetailReport, PatrolSummaryReport, PatrolType } from "@patrol-log/shared";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import { Field, inputCls, selectCls } from "../components/Modal";
import {
  downloadDetailCsv,
  downloadDetailExcel,
  downloadSummaryCsv,
  downloadSummaryExcel,
  patrolTypeLabel,
} from "../lib/reportExport";

const TYPES: { value: "" | PatrolType; label: string }[] = [
  { value: "", label: "All types" },
  { value: "foot", label: "Foot" },
  { value: "vehicle", label: "Vehicle" },
  { value: "static", label: "Static" },
  { value: "sector_monitoring", label: "Sector monitoring" },
  { value: "ops", label: "OPS" },
  { value: "responding", label: "Responding" },
];

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toDateInput(d);
}

function defaultTo(): string {
  return toDateInput(new Date());
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildQuery(from: string, to: string, patrolType: string): string {
  const params = new URLSearchParams({ from, to });
  if (patrolType) params.set("patrol_type", patrolType);
  return params.toString();
}

export function ReportsPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [patrolType, setPatrolType] = useState<"" | PatrolType>("");
  const [applied, setApplied] = useState({ from: defaultFrom(), to: defaultTo(), patrolType: "" as "" | PatrolType });

  const filtersValid = Boolean(from && to && from <= to);

  const queryKey = useMemo(
    () => ["admin.reports", applied.from, applied.to, applied.patrolType] as const,
    [applied],
  );

  const detailQ = useQuery({
    queryKey: [...queryKey, "detail"],
    queryFn: () =>
      adminFetch<PatrolDetailReport>(
        `/admin/reports/detail?${buildQuery(applied.from, applied.to, applied.patrolType)}`,
      ),
    enabled: filtersValid,
  });

  const summaryQ = useQuery({
    queryKey: [...queryKey, "summary"],
    queryFn: () =>
      adminFetch<PatrolSummaryReport>(
        `/admin/reports/summary?${buildQuery(applied.from, applied.to, applied.patrolType)}`,
      ),
    enabled: filtersValid,
  });

  function applyFilters() {
    if (!filtersValid) return;
    setApplied({ from, to, patrolType });
  }

  const detail = detailQ.data;
  const summary = summaryQ.data;
  const loading = detailQ.isLoading || summaryQ.isLoading;
  const error = detailQ.isError || summaryQ.isError;

  return (
    <>
      <PageHeader title="Reports" />

      <div className="mb-5 rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Filters</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label="From">
            <input
              type="date"
              className={inputCls}
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputCls}
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Type of Patrol">
            <select
              className={selectCls}
              value={patrolType}
              onChange={(e) => setPatrolType(e.target.value as "" | PatrolType)}
            >
              {TYPES.map((t) => (
                <option key={t.value || "all"} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={"\u00a0"}>
            <button
              type="button"
              disabled={!filtersValid}
              onClick={applyFilters}
              className="w-full rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Apply filters
            </button>
          </Field>
        </div>
        {!filtersValid && (
          <p className="text-xs text-red-600">Choose a valid date range (From on or before To).</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Showing {applied.from} → {applied.to}
          {" · "}
          {patrolTypeLabel(applied.patrolType || null)}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading reports…</p>
      ) : error ? (
        <p className="text-sm text-red-600">Failed to load report data.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCard
            title="1. Detail Report"
            description="One row per patroller on each patrol — primary and passengers (passengers show 0 km)."
            countLabel={`${detail?.rows.length ?? 0} rows`}
            onCsv={() => detail && downloadDetailCsv(detail)}
            onExcel={() => detail && downloadDetailExcel(detail)}
            disabled={!detail}
          >
            {detail && detail.rows.length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th className="px-3 py-2">Call Sign / Name</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Km</th>
                      <th className="px-3 py-2 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.rows.slice(0, 8).map((r, i) => (
                      <tr key={`${r.callSign}-${r.role}-${r.commencedAt}-${i}`}>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {r.callSign} / {r.name}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {r.role === "joined" ? "Passenger" : r.role === "guest" ? "Guest" : "Primary"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{patrolTypeLabel(r.patrolType)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.distanceKm}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.durationLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.rows.length > 8 && (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    +{detail.rows.length - 8} more in download
                  </p>
                )}
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-gray-400">No patrols in this range</p>
            )}
          </ReportCard>

          <ReportCard
            title="2. Summary Report"
            description="Member totals for the date range and type, plus Top 10 Hours and Top 10 KM leaderboards."
            countLabel={`${summary?.members.length ?? 0} members`}
            onCsv={() => summary && downloadSummaryCsv(summary)}
            onExcel={() => summary && downloadSummaryExcel(summary)}
            disabled={!summary}
          >
            {summary && summary.members.length > 0 ? (
              <div className="space-y-4 p-3">
                <MiniBoard
                  title="Top 10 Hours"
                  rows={summary.topHours.map((m) => ({
                    label: `${m.callSign} / ${m.name}`,
                    value: `${m.totalHours}h`,
                  }))}
                />
                <MiniBoard
                  title="Top 10 KM"
                  rows={summary.topKm.map((m) => ({
                    label: `${m.callSign} / ${m.name}`,
                    value: `${m.totalKm} km`,
                  }))}
                />
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-gray-400">No completed patrols in this range</p>
            )}
          </ReportCard>
        </div>
      )}
    </>
  );
}

function ReportCard({
  title,
  description,
  countLabel,
  onCsv,
  onExcel,
  disabled,
  children,
}: {
  title: string;
  description: string;
  countLabel: string;
  onCsv: () => void;
  onExcel: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-xs text-gray-500">{description}</p>
          </div>
          <span className="text-xs text-gray-400">{countLabel}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onCsv}
            className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40"
          >
            Download CSV
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onExcel}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Download Excel
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function MiniBoard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={`${title}-${r.label}`} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-gray-800">
                <span className="mr-1.5 text-xs text-gray-400">{i + 1}.</span>
                {r.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-gray-900">{r.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
