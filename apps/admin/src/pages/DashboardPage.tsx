import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin.stats"],
    queryFn: () => adminFetch<{ active_patrols: number; residents: number; members: number }>("/admin/stats"),
  });

  return (
    <>
      <PageHeader title="Dashboard" />
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Active patrols" value={data?.active_patrols ?? 0} accent="bg-brand-primary" />
          <StatCard label="Residents on record" value={data?.residents ?? 0} accent="bg-brand-info" />
          <StatCard label="CPF members" value={data?.members ?? 0} accent="bg-brand-warning" />
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-white border rounded p-6">
      <div className={`w-10 h-1 rounded mb-4 ${accent}`} />
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-extrabold">{value}</p>
    </div>
  );
}
