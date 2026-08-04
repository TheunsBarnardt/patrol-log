import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardMemberStats, DashboardOverview, PatrolType, StatsPeriod } from "@patrol-log/shared";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import { Field, inputCls, selectCls } from "../components/Modal";
import { downloadPatrolReportPdf } from "../lib/reportPdf";
import { patrolTypeLabel } from "../lib/reportExport";

type SortKey = "callSign" | "patrolCount" | "hours" | "km";
type PresetPeriod = Exclude<StatsPeriod, "custom">;

const PERIODS: { id: PresetPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "Month" },
];

const TYPES: { value: "" | PatrolType; label: string }[] = [
  { value: "", label: "All types" },
  { value: "foot", label: "Foot" },
  { value: "vehicle", label: "Vehicle" },
  { value: "static", label: "Static" },
  { value: "sector_monitoring", label: "Sector monitoring" },
  { value: "ops", label: "OPS" },
  { value: "responding", label: "Responding" },
];

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rangeForPreset(period: PresetPeriod): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (period === "today") {
    // same day
  } else if (period === "month") {
    from.setDate(1);
  } else {
    const days = period === "7d" ? 6 : 29;
    from.setDate(from.getDate() - days);
  }
  return { from: toDateInput(from), to: toDateInput(to) };
}

function buildOverviewQuery(from: string, to: string, patrolType: string): string {
  const params = new URLSearchParams({ from, to });
  if (patrolType) params.set("patrol_type", patrolType);
  return params.toString();
}

export function DashboardPage() {
  const initial = rangeForPreset("7d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [patrolType, setPatrolType] = useState<"" | PatrolType>("");
  const [preset, setPreset] = useState<PresetPeriod | "custom">("7d");
  const [applied, setApplied] = useState({
    from: initial.from,
    to: initial.to,
    patrolType: "" as "" | PatrolType,
    preset: "7d" as PresetPeriod | "custom",
  });
  const [sortKey, setSortKey] = useState<SortKey>("hours");
  const [sortAsc, setSortAsc] = useState(false);

  const filtersValid = Boolean(from && to && from <= to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin.stats.overview", applied.from, applied.to, applied.patrolType],
    queryFn: () =>
      adminFetch<DashboardOverview>(
        `/admin/stats/overview?${buildOverviewQuery(applied.from, applied.to, applied.patrolType)}`,
      ),
    enabled: Boolean(applied.from && applied.to && applied.from <= applied.to),
  });

  const members = useMemo(() => {
    const rows = [...(data?.members ?? [])];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return rows;
  }, [data?.members, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "callSign");
    }
  }

  function applyPreset(id: PresetPeriod) {
    const range = rangeForPreset(id);
    setPreset(id);
    setFrom(range.from);
    setTo(range.to);
    setApplied({ from: range.from, to: range.to, patrolType, preset: id });
  }

  function applyFilters() {
    if (!filtersValid) return;
    setPreset("custom");
    setApplied({ from, to, patrolType, preset: "custom" });
  }

  const chartData = useMemo(
    () =>
      (data?.kmByDay ?? []).map((d) => ({
        ...d,
        label: formatDayLabel(d.date, applied.preset === "custom" ? "custom" : applied.preset),
      })),
    [data?.kmByDay, applied.preset],
  );

  return (
    <>
      <PageHeader
        title={
          data?.sector?.code || data?.sector?.name
            ? `Dashboard · ${data.sector.code || data.sector.name}`
            : "Dashboard"
        }
        action={
          <button
            type="button"
            disabled={!data}
            onClick={() => data && downloadPatrolReportPdf(data)}
            className="min-h-[40px] rounded-xl bg-brand-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            Download PDF
          </button>
        }
      />

      <div className="mb-5 rounded-2xl border border-brand-line bg-white p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-brand-ink">Filters</h2>
          <div className="inline-flex w-full rounded-xl border border-brand-line bg-brand-canvas p-0.5 text-sm sm:w-auto">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={
                  preset === p.id
                    ? "flex-1 rounded-lg bg-brand-primary px-3 py-2 font-semibold text-white sm:flex-none"
                    : "flex-1 rounded-lg px-3 py-2 font-medium text-brand-muted hover:bg-white hover:text-brand-primary sm:flex-none"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label="From">
            <input
              type="date"
              className={inputCls}
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputCls}
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
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

      {isLoading ? (
        <p className="text-sm text-brand-muted">Loading overview…</p>
      ) : isError || !data ? (
        <p className="text-sm font-medium text-brand-accent">Failed to load dashboard stats.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Distance" value={`${data.kpis.totalKm.toLocaleString()} km`} accent="bg-brand-primary" tint="bg-brand-primarySoft" />
            <StatCard label="Patrol hours" value={data.kpis.totalHours.toLocaleString()} accent="bg-brand-green" tint="bg-brand-greenSoft" />
            <StatCard label="Completed" value={String(data.kpis.completedPatrols)} accent="bg-brand-yellow" tint="bg-amber-50" />
            <StatCard label="Active now" value={String(data.kpis.activePatrols)} accent="bg-brand-accent" tint="bg-red-50" />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-brand-muted">
            <span className="font-semibold text-brand-ink">Hours by type</span>
            <TypeChip label="Foot" hours={data.hoursByType.foot ?? 0} />
            <TypeChip label="Vehicle" hours={data.hoursByType.vehicle ?? 0} />
            <TypeChip label="Static" hours={data.hoursByType.static ?? 0} />
            <TypeChip label="Monitoring" hours={data.hoursByType.sector_monitoring ?? 0} />
            <TypeChip label="OPS" hours={data.hoursByType.ops ?? 0} />
            <TypeChip label="Responding" hours={data.hoursByType.responding ?? 0} />
            <span className="w-full text-xs text-brand-muted sm:ml-auto sm:w-auto">
              {data.kpis.uniqueMembers} member{data.kpis.uniqueMembers === 1 ? "" : "s"} patrolled
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card lg:col-span-3">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-bold text-brand-ink">Km by day</h2>
                <span className="text-xs text-brand-muted">Vehicle patrols</span>
              </div>
              {chartData.every((d) => d.km === 0) ? (
                <div className="flex h-56 items-center justify-center text-sm text-brand-muted">
                  No vehicle distance in this period
                </div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#D7E0EE" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5B6B85" }} axisLine={false} tickLine={false} />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#5B6B85" }}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <Tooltip
                        cursor={{ fill: "#E8F0FA" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid #D7E0EE", fontSize: 12 }}
                        formatter={(value: number) => [`${value} km`, "Distance"]}
                      />
                      <Bar dataKey="km" fill="#0B3D8C" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card lg:col-span-2">
              <h2 className="mb-3 text-sm font-bold text-brand-ink">Quick totals</h2>
              <dl className="space-y-3 text-sm">
                <QuickRow label="Avg km / completed" value={avg(data.kpis.totalKm, data.kpis.completedPatrols, "km")} />
                <QuickRow label="Avg hours / completed" value={avg(data.kpis.totalHours, data.kpis.completedPatrols, "h")} />
                <QuickRow label="From" value={new Date(data.periodStart).toLocaleString()} />
                <QuickRow label="To" value={new Date(data.periodEnd).toLocaleString()} />
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-brand-muted">
                Hours count for every patrol member. Vehicle km is credited to the primary only.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-brand-line bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-brand-line px-4 py-3">
              <h2 className="text-sm font-bold text-brand-ink">Member leaderboard</h2>
              <span className="text-xs text-brand-muted">Sortable</span>
            </div>
            {members.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-brand-muted">
                No completed patrols in this period
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="border-b border-brand-line bg-brand-primarySoft/50 text-left text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                      <SortTh label="Call sign" active={sortKey === "callSign"} asc={sortAsc} onClick={() => toggleSort("callSign")} />
                      <th className="px-4 py-3">Name</th>
                      <SortTh label="Patrols" active={sortKey === "patrolCount"} asc={sortAsc} onClick={() => toggleSort("patrolCount")} className="text-right" />
                      <SortTh label="Hours" active={sortKey === "hours"} asc={sortAsc} onClick={() => toggleSort("hours")} className="text-right" />
                      <SortTh label="Km" active={sortKey === "km"} asc={sortAsc} onClick={() => toggleSort("km")} className="text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-line/70">
                    {members.map((m) => (
                      <MemberRow key={m.patrollerId} row={m} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
  tint,
}: {
  label: string;
  value: string;
  accent: string;
  tint: string;
}) {
  return (
    <div className={`rounded-2xl border border-brand-line p-4 shadow-card ${tint}`}>
      <div className={`mb-3 h-1.5 w-10 rounded-full ${accent}`} />
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-brand-ink">{value}</p>
    </div>
  );
}

function TypeChip({ label, hours }: { label: string; hours: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-line bg-white px-2.5 py-1 text-xs text-brand-ink shadow-sm">
      <span className="font-semibold">{label}</span>
      <span className="font-medium text-brand-muted">{hours}h</span>
    </span>
  );
}

function QuickRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-brand-line/60 pb-2 last:border-0">
      <dt className="text-brand-muted">{label}</dt>
      <dd className="font-bold text-brand-ink">{value}</dd>
    </div>
  );
}

function SortTh({
  label,
  active,
  asc,
  onClick,
  className = "",
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={`px-4 py-3 ${className}`}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-brand-primary">
        {label}
        <span className="text-[10px] text-brand-muted">{active ? (asc ? "▲" : "▼") : "◇"}</span>
      </button>
    </th>
  );
}

function MemberRow({ row }: { row: DashboardMemberStats }) {
  return (
    <tr className="hover:bg-brand-primarySoft/40">
      <td className="px-4 py-3 font-bold text-brand-ink">{row.callSign}</td>
      <td className="px-4 py-3 text-brand-muted">{row.name}</td>
      <td className="px-4 py-3 text-right tabular-nums">{row.patrolCount}</td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold text-brand-primary">{row.hours}</td>
      <td className="px-4 py-3 text-right tabular-nums">{row.km}</td>
    </tr>
  );
}

function formatDayLabel(date: string, period: StatsPeriod): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (period === "30d" || period === "custom") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
}

function avg(total: number, count: number, unit: string): string {
  if (!count) return `— ${unit}`;
  const v = Math.round((total / count) * 10) / 10;
  return `${v} ${unit}`;
}
