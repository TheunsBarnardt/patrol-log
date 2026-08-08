import { authStore } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import { APP_VERSION } from "../version";

function formatAccessLevel(level: string) {
  return level.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Patroller-only view: own profile details, nothing else. */
export function MyDetailsPage() {
  const profile = authStore.getProfile();
  if (!profile) return null;

  const rows: Array<[string, string]> = [
    ["Call sign", profile.call_sign],
    ["Name", profile.name],
    ["Access", formatAccessLevel(profile.access_level)],
    ["Organization", profile.organization],
    ["Sector", profile.sector],
    ["Province", profile.province],
    ["App version", APP_VERSION],
  ];

  return (
    <>
      <PageHeader title="My details" />
      <div className="max-w-lg rounded-xl border border-gray-200 bg-white shadow-sm">
        <dl className="divide-y divide-gray-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-gray-500">{label}</dt>
              <dd className="text-sm font-medium text-gray-900 text-right">{value || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-4 text-sm text-gray-500">
        Patrollers can view their own details here. Use the mobile app for patrols, messaging, and maps.
      </p>
    </>
  );
}
