import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader } from "../components/DataTable";

interface DeviceJoin {
  devices: {
    id: string;
    deviceId: string;
    status: "active" | "revoked";
    userAgent: string | null;
    lastSeenAt: string;
  };
  patrollers: {
    id: string;
    callSign: string;
    name: string;
  } | null;
}

export function DevicesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin.devices"],
    queryFn: () => adminFetch<{ results: DeviceJoin[] }>("/admin/devices"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/devices/${id}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.devices"] }),
  });

  return (
    <>
      <PageHeader title="Devices" />
      {isLoading ? <p>Loading...</p> : (
        <DataTable
          rows={data?.results ?? []}
          keyExtractor={(r) => r.devices.id}
          columns={[
            { header: "Patroller", render: (r) => r.patrollers ? `${r.patrollers.callSign} — ${r.patrollers.name}` : "—" },
            { header: "Device ID", render: (r) => <span className="font-mono text-xs">{r.devices.deviceId.slice(0, 12)}</span> },
            { header: "User agent", render: (r) => <span className="text-xs text-gray-500">{r.devices.userAgent ?? "—"}</span> },
            { header: "Last seen", render: (r) => new Date(r.devices.lastSeenAt).toLocaleString() },
            {
              header: "Status",
              render: (r) => (
                <span className={`text-xs font-bold uppercase ${r.devices.status === "active" ? "text-emerald-700" : "text-red-600"}`}>{r.devices.status}</span>
              ),
            },
            {
              header: "",
              className: "text-right",
              render: (r) => (
                r.devices.status === "active" ? (
                  <button onClick={() => revoke.mutate(r.devices.id)} className="text-red-600 hover:underline">Revoke</button>
                ) : null
              ),
            },
          ]}
        />
      )}
    </>
  );
}
