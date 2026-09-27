import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, authStore } from "../lib/api";
import { Btn, inputCls, selectCls } from "../components/Modal";
import { ResidentsPage } from "./ResidentsPage";
import { MembersPage } from "./MembersPage";
import { EmergencyServicesPage } from "./EmergencyServicesPage";
import { VehiclesPage } from "./VehiclesPage";
import { HotspotsPage } from "./HotspotsPage";
import { NeedleTrainingPanel } from "./NeedleTrainingPanel";

interface Sector { id: string; name: string; code: string | null }
interface PasteGroup { id: string; name: string; sectorId: string; receivedFrom: "CPF Group" | "Other Groups" }
interface Meta {
  sectors: Sector[];
  pasteGroups: PasteGroup[];
}

const TABS = [
  { id: "groups", label: "Groups", hint: "WhatsApp groups for the occurrence book" },
  { id: "needle", label: "Needle training", hint: "History trainer, live thumbs, and improvement graph" },
  { id: "residents", label: "Residents", hint: "People who live in the sector" },
  { id: "members", label: "Members", hint: "CPF members, call signs, and access" },
  { id: "emergency-services", label: "Emergency services", hint: "Police, ambulance, fire, and other numbers" },
  { id: "vehicles", label: "Vehicles", hint: "Patrol vehicles and who uses them" },
  { id: "hotspots", label: "Hotspots", hint: "Risk areas shown on the map" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function TabIcon({ id }: { id: TabId }) {
  const common = { viewBox: "0 0 24 24", className: "h-5 w-5", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true as const };
  if (id === "groups") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="2.4" />
        <circle cx="16" cy="9" r="2" />
        <path d="M4.5 18.5c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6" />
        <path d="M14 15.2c1.3-.5 2.6-.4 3.8.5 1 .7 1.6 1.7 1.9 2.8" />
      </svg>
    );
  }
  if (id === "needle") {
    return (
      <svg {...common}>
        <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>
    );
  }
  if (id === "residents") {
    return (
      <svg {...common}>
        <path d="M4 20V10l8-6 8 6v10" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (id === "members") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 19c1.2-3 3.6-4.5 7-4.5s5.8 1.5 7 4.5" />
      </svg>
    );
  }
  if (id === "emergency-services") {
    return (
      <svg {...common}>
        <path d="M12 4l7 3v5c0 4.2-2.8 7.2-7 8-4.2-.8-7-3.8-7-8V7l7-3z" />
        <path d="M12 9v5M9.5 11.5h5" />
      </svg>
    );
  }
  if (id === "vehicles") {
    return (
      <svg {...common}>
        <path d="M4 15v-2l2-5h12l2 5v2" />
        <path d="M4 15h16v3H4z" />
        <circle cx="7.5" cy="18" r="1.2" />
        <circle cx="16.5" cy="18" r="1.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function Pane({ label, blurb, children }: { label: string; blurb: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-1 flex-col">
      <p className="text-sm text-gray-500">Settings &gt; {label}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">{label}</h1>
      <p className="mt-2 max-w-3xl text-sm text-gray-600">{blurb}</p>
      <div className="mt-6 w-full flex-1">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = authStore.getProfile();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [receivedFrom, setReceivedFrom] = useState<"CPF Group" | "Other Groups">("CPF Group");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const known = TABS.some((item) => item.id === section);
  const tab: TabId = known ? (section as TabId) : "groups";

  const meta = useQuery({
    queryKey: ["admin.ob.meta"],
    queryFn: () => adminFetch<Meta>("/admin/ob/meta"),
    enabled: tab === "groups",
  });

  const tabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q));
  }, [query]);

  const sectors = meta.data?.sectors ?? [];
  const groups = [...(meta.data?.pasteGroups ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const sectorName = (id: string) => sectors.find((sector) => sector.id === id)?.name ?? "Sector";

  async function addGroup() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Enter a group name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const row = await adminFetch<PasteGroup>("/admin/ob/paste-groups", {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          sector_id: sectorId || profile?.sector_id || sectors[0]?.id,
          received_from: receivedFrom,
        }),
      });
      setName("");
      qc.setQueryData<Meta>(["admin.ob.meta"], (current) => current
        ? { ...current, pasteGroups: [...current.pasteGroups.filter((group) => group.id !== row.id), row] }
        : current);
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the group");
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(id: string) {
    setError("");
    try {
      await adminFetch(`/admin/ob/paste-groups/${id}`, { method: "DELETE" });
      qc.setQueryData<Meta>(["admin.ob.meta"], (current) => current
        ? { ...current, pasteGroups: current.pasteGroups.filter((group) => group.id !== id) }
        : current);
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the group");
    }
  }

  if (section && !known) return <Navigate to="/settings" replace />;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#f3f3f3]">
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-black/10 bg-[#f7f7f7] sm:w-64">
        <div className="p-3">
          <label className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="6" />
                <path d="M16 16l4 4" />
              </svg>
            </span>
            <input
              className="w-full rounded-full border border-black/10 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-gray-400"
              placeholder="Find a setting"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label="Settings">
          {tabs.map((item) => {
            const selected = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${selected ? "bg-black/10 font-semibold text-gray-900" : "text-gray-800 hover:bg-black/5"}`}
                onClick={() => navigate(item.id === "groups" ? "/settings" : `/settings/${item.id}`)}
              >
                {selected && <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-[#0067c0]" aria-hidden />}
                <span className="text-gray-700"><TabIcon id={item.id} /></span>
                {item.label}
              </button>
            );
          })}
          {tabs.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No settings match.</p>}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex w-full flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8">
          {tab === "groups" && (
            <div className="flex w-full flex-1 flex-col">
              <p className="text-sm text-gray-500">Settings &gt; Groups</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">Groups</h1>
              <p className="mt-2 max-w-3xl text-sm text-gray-600">
                WhatsApp groups the desk pastes into the occurrence book. Add a group here, then choose it when you log an incident.
              </p>
              {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

              <section className="mt-6 w-full rounded-lg border border-black/10 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">Add a group</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-sm">
                    <span className="mb-1 block text-gray-600">Group name</span>
                    <input className={inputCls} placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-gray-600">Sector</span>
                    <select className={selectCls} value={sectorId || profile?.sector_id || sectors[0]?.id || ""} onChange={(e) => setSectorId(e.target.value)}>
                      {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}{sector.code ? ` (${sector.code})` : ""}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-gray-600">Received from</span>
                    <select className={selectCls} value={receivedFrom} onChange={(e) => setReceivedFrom(e.target.value as "CPF Group" | "Other Groups")}>
                      <option value="CPF Group">CPF Group</option>
                      <option value="Other Groups">Other Groups</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <Btn onClick={() => void addGroup()} disabled={saving}>{saving ? "Adding…" : "Add group"}</Btn>
                  </div>
                </div>
              </section>

              <section className="mt-4 flex min-h-48 w-full flex-1 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
                <h2 className="border-b border-black/5 px-5 py-4 text-base font-semibold text-gray-900">Saved groups</h2>
                {meta.isLoading && <p className="px-5 py-4 text-sm text-gray-500">Loading…</p>}
                {meta.isError && <p className="px-5 py-4 text-sm text-red-700">The group list could not be loaded.</p>}
                {!meta.isLoading && groups.length === 0 && <p className="px-5 py-4 text-sm text-gray-500">No groups yet.</p>}
                <ul className="min-h-0 flex-1 overflow-auto">
                  {groups.map((group) => (
                    <li key={group.id} className="flex items-center justify-between gap-3 border-t border-black/5 px-5 py-3 first:border-t-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{group.name}</p>
                        <p className="text-xs text-gray-500">{sectorName(group.sectorId)} · {group.receivedFrom}</p>
                      </div>
                      <button type="button" className="shrink-0 text-sm text-red-700 hover:underline" onClick={() => void removeGroup(group.id)}>Remove</button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {tab === "needle" && (
            <Pane
              label="Needle training"
              blurb="Import historical messages and train one by one without creating incidents. Live occurrence book thumbs still count. The graph tracks how fills improve."
            >
              <NeedleTrainingPanel />
            </Pane>
          )}

          {tab === "residents" && (
            <Pane label="Residents" blurb="People who live in the sector. Search, add, or import them here.">
              <ResidentsPage embedded />
            </Pane>
          )}
          {tab === "members" && (
            <Pane label="Members" blurb="CPF members, their call signs, and what they can open in the portal.">
              <MembersPage embedded />
            </Pane>
          )}
          {tab === "emergency-services" && (
            <Pane label="Emergency services" blurb="Police, ambulance, fire, and the other numbers the desk keeps on hand.">
              <EmergencyServicesPage embedded />
            </Pane>
          )}
          {tab === "vehicles" && (
            <Pane label="Vehicles" blurb="Patrol vehicles, their status, and which member uses each one.">
              <VehiclesPage embedded />
            </Pane>
          )}
          {tab === "hotspots" && (
            <Pane label="Hotspots" blurb="Risk areas for the sector. Patrollers see them on the mobile hotspots map.">
              <HotspotsPage embedded />
            </Pane>
          )}
        </div>
      </div>
    </div>
  );
}
