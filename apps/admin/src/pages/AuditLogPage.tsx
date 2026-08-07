import { useQuery } from "@tanstack/react-query";
import { parseSqliteUtc } from "@patrol-log/shared";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader } from "../components/DataTable";

interface AuditJoin {
  audit_log: {
    id: string;
    action: string;
    ip: string | null;
    deviceId: string | null;
    createdAt: string;
  };
  patrollers: { callSign: string; name: string } | null;
}

export function AuditLogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin.audit-log"],
    queryFn: () => adminFetch<{ results: AuditJoin[] }>("/admin/audit-log"),
  });

  return (
    <>
      <PageHeader
        title="Audit log (POPIA)"
      />
      <p className="text-xs text-gray-500 px-1 mb-3">
        Record of all administrative actions. Payload data is withheld in compliance with POPIA.
      </p>
      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <DataTable
          rows={data?.results ?? []}
          keyExtractor={(r) => r.audit_log.id}
          columns={[
            { header: "When", render: (r) => (parseSqliteUtc(r.audit_log.createdAt) ?? new Date(r.audit_log.createdAt)).toLocaleString() },
            { header: "Actor", render: (r) => r.patrollers ? `${r.patrollers.callSign} — ${r.patrollers.name}` : "—" },
            { header: "Action", render: (r) => <span className="font-mono text-xs">{r.audit_log.action}</span> },
            { header: "IP", render: (r) => r.audit_log.ip ?? "—" },
            { header: "Device", render: (r) => r.audit_log.deviceId ? <span className="font-mono text-xs truncate max-w-[120px] block">{r.audit_log.deviceId}</span> : "—" },
          ]}
        />
      )}
    </>
  );
}
