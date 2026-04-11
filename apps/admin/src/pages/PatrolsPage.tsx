import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader } from "../components/DataTable";

interface Patrol {
  id: string;
  primaryPatrollerId: string;
  patrolType: "foot" | "vehicle" | "static";
  state: "active" | "stood_down";
  startTime: string;
  endTime: string | null;
  distanceKm: number | null;
  sarsCompliant: boolean;
  recordSealHash: string | null;
}

export function PatrolsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin.patrols"],
    queryFn: () => adminFetch<{ results: Patrol[] }>("/admin/patrols"),
  });

  return (
    <>
      <PageHeader title="Patrols" />
      {isLoading ? <p>Loading...</p> : (
        <DataTable
          rows={data?.results ?? []}
          columns={[
            { header: "ID", render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}</span> },
            { header: "Type", render: (r) => r.patrolType },
            {
              header: "State",
              render: (r) => (
                <span className={`text-xs font-bold uppercase ${r.state === "active" ? "text-emerald-700" : "text-gray-500"}`}>{r.state}</span>
              ),
            },
            { header: "Start", render: (r) => new Date(r.startTime).toLocaleString() },
            { header: "End", render: (r) => (r.endTime ? new Date(r.endTime).toLocaleString() : "—") },
            { header: "Distance", render: (r) => (r.distanceKm != null ? `${r.distanceKm} km` : "—") },
            {
              header: "SARS",
              render: (r) => (r.sarsCompliant ? <span className="text-emerald-700 font-bold">✓</span> : <span className="text-brand-warning font-bold">!</span>),
            },
            {
              header: "Seal",
              render: (r) => (r.recordSealHash ? <span className="font-mono text-xs text-gray-500">{r.recordSealHash.slice(0, 10)}…</span> : "—"),
            },
          ]}
        />
      )}
    </>
  );
}
