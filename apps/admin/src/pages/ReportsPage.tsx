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

      <div className="mb-5 rounded-2xl border border-brand-line bg-white p-4 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-brand-ink">Filters</h2>
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
          <Field label={'\u00a0'}>
            <button
              type="button"
              disabled={!filtersValid}
              onClick={applyFilters}
              className="w-full rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-primaryDark disabled:opacity-40"
            >
              Apply filters
            </button>
          </Field>
        </div>
        {!filtersValid && (
          <p className="text-xs font-medium text-brand-accent">Choose a valid date range (From on or before To).</p>
        )}
        <p className="mt-1 text-xs text-brand-muted">
          Showing {applied.from} → {applied.to}
          {" · "}
          {patrolTypeLabel(applied.patrolType || null)}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading reports…</p>
      ) : error ? (
        <p className="text-sm font-medium text-brand-accent">Failed to load report data.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCard
            title="1. Detail Report"
            description="One row per patrol in the date range and type — call sign, sector, times, duration, distance, and vehicle."
            countLabel={`${detail?.rows.length ?? 0} patrols`}
            onCsv={() => detail && downloadDetailCsv(detail)}
            onExcel={() => detail && downloadDetailExcel(detail)}
            disabled={!detail}
          >
            {detail && detail.rows.length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full min-w-[22rem] text-sm">
                  <thead>
                    <tr className="border-b border-brand-line bg-brand-primarySoft/50 text-left text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                      <th className="px-3 py-2">Call Sign / Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Km</th>
                      <th className="px-3 py-2 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-line/70">
                    {detail.rows.slice(0, 8).map((r, i) => (
                      <tr key={`${r.callSign}-${r.commencedAt}-${i}`}>
                        <td className="px-3 py-2 font-semibold text-brand-ink">
                          {r.callSign} / {r.name}
                        </td>
                        <td className="px-3 py-2 text-brand-muted">{patrolTypeLabel(r.patrolType)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.distanceKm}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-primary">{r.durationLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.rows.length > 8 && (
                  <p className="px-3 py-2 text-xs text-brand-muted">
                    +{detail.rows.length - 8} more in download
                  </p>
                )}
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-brand-muted">No patrols in this range</p>
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
              <p className="px-3 py-8 text-center text-sm text-brand-muted">No completed patrols in this range</p>
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
    <div className="overflow-hidden rounded-2xl border border-brand-line bg-white shadow-card">
      <div className="border-b border-brand-line px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-brand-ink">{title}</h2>
            <p className="mt-1 text-xs text-brand-muted">{description}</p>
          </div>
          <span className="rounded-full bg-brand-primarySoft px-2.5 py-1 text-xs font-semibold text-brand-primary">
            {countLabel}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onCsv}
            className="min-h-[40px] flex-1 rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-bold text-brand-ink hover:bg-brand-primarySoft disabled:opacity-40 sm:flex-none"
          >
            Download CSV
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onExcel}
            className="min-h-[40px] flex-1 rounded-xl bg-brand-primary px-3 py-2 text-sm font-bold text-white hover:bg-brand-primaryDark disabled:opacity-40 sm:flex-none"
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
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-brand-muted">—</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={`${title}-${r.label}`} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-brand-ink">
                <span className="mr-1.5 text-xs font-bold text-brand-primary">{i + 1}.</span>
                {r.label}
              </span>
              <span className="shrink-0 font-bold tabular-nums text-brand-ink">{r.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
