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
import type { DashboardMemberStats, DashboardOverview, StatsPeriod } from "@patrol-log/shared";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";

type SortKey = "callSign" | "patrolCount" | "hours" | "km";

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

export function DashboardPage() {
  const [period, setPeriod] = useState<StatsPeriod>("7d");
  const [sortKey, setSortKey] = useState<SortKey>("hours");
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin.stats.overview", period],
    queryFn: () => adminFetch<DashboardOverview>(`/admin/stats/overview?period=${period}`),
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

  const chartData = useMemo(
    () =>
      (data?.kmByDay ?? []).map((d) => ({
        ...d,
        label: formatDayLabel(d.date, period),
      })),
    [data?.kmByDay, period],
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        action={
          <div className="inline-flex rounded-lg border bg-white p-0.5 text-sm">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={
                  period === p.id
                    ? "rounded-md bg-brand-primary px-3 py-1.5 font-medium text-white"
                    : "rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading overview…</p>
      ) : isError || !data ? (
        <p className="text-sm text-red-600">Failed to load dashboard stats.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Distance" value={`${data.kpis.totalKm.toLocaleString()} km`} accent="bg-brand-primary" />
            <StatCard label="Patrol hours" value={data.kpis.totalHours.toLocaleString()} accent="bg-brand-info" />
            <StatCard label="Completed" value={String(data.kpis.completedPatrols)} accent="bg-brand-warning" />
            <StatCard label="Active now" value={String(data.kpis.activePatrols)} accent="bg-emerald-500" />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className="font-medium text-gray-700">Hours by type</span>
            <TypeChip label="Foot" hours={data.hoursByType.foot} />
            <TypeChip label="Vehicle" hours={data.hoursByType.vehicle} />
            <TypeChip label="Static" hours={data.hoursByType.static} />
            <span className="ml-auto text-xs text-gray-400">
              {data.kpis.uniqueMembers} member{data.kpis.uniqueMembers === 1 ? "" : "s"} patrolled
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-xl border bg-white p-4 lg:col-span-3">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Km by day</h2>
                <span className="text-xs text-gray-400">Vehicle patrols</span>
              </div>
              {chartData.every((d) => d.km === 0) ? (
                <div className="flex h-56 items-center justify-center text-sm text-gray-400">
                  No vehicle distance in this period
                </div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <Tooltip
                        cursor={{ fill: "#f3f4f6" }}
                        contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                        formatter={(value: number) => [`${value} km`, "Distance"]}
                      />
                      <Bar dataKey="km" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-white p-4 lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Quick totals</h2>
              <dl className="space-y-3 text-sm">
                <QuickRow label="Avg km / completed" value={avg(data.kpis.totalKm, data.kpis.completedPatrols, "km")} />
                <QuickRow label="Avg hours / completed" value={avg(data.kpis.totalHours, data.kpis.completedPatrols, "h")} />
                <QuickRow label="Period start" value={new Date(data.periodStart).toLocaleString()} />
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-gray-400">
                Hours count for every patrol member. Vehicle km is credited to the primary only.
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Member leaderboard</h2>
              <span className="text-xs text-gray-400">Sortable</span>
            </div>
            {members.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-gray-400">
                No completed patrols in this period
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <SortTh label="Call sign" active={sortKey === "callSign"} asc={sortAsc} onClick={() => toggleSort("callSign")} />
                      <th className="px-4 py-3">Name</th>
                      <SortTh label="Patrols" active={sortKey === "patrolCount"} asc={sortAsc} onClick={() => toggleSort("patrolCount")} className="text-right" />
                      <SortTh label="Hours" active={sortKey === "hours"} asc={sortAsc} onClick={() => toggleSort("hours")} className="text-right" />
                      <SortTh label="Km" active={sortKey === "km"} asc={sortAsc} onClick={() => toggleSort("km")} className="text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
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

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className={`mb-3 h-1 w-10 rounded ${accent}`} />
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-gray-900">{value}</p>
    </div>
  );
}

function TypeChip({ label, hours }: { label: string; hours: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs text-gray-700">
      <span className="font-medium">{label}</span>
      <span className="text-gray-500">{hours}h</span>
    </span>
  );
}

function QuickRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gray-50 pb-2 last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-semibold text-gray-900">{value}</dd>
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
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-gray-800">
        {label}
        <span className="text-[10px] text-gray-400">{active ? (asc ? "▲" : "▼") : "◇"}</span>
      </button>
    </th>
  );
}

function MemberRow({ row }: { row: DashboardMemberStats }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-semibold text-gray-900">{row.callSign}</td>
      <td className="px-4 py-3 text-gray-600">{row.name}</td>
      <td className="px-4 py-3 text-right tabular-nums">{row.patrolCount}</td>
      <td className="px-4 py-3 text-right tabular-nums">{row.hours}</td>
      <td className="px-4 py-3 text-right tabular-nums">{row.km}</td>
    </tr>
  );
}

function formatDayLabel(date: string, period: StatsPeriod): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (period === "30d") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
}

function avg(total: number, count: number, unit: string): string {
  if (!count) return `— ${unit}`;
  const v = Math.round((total / count) * 10) / 10;
  return `${v} ${unit}`;
}
