import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, authStore } from "../lib/api";
import { Btn, inputCls, selectCls } from "../components/Modal";

interface Sector { id: string; name: string; code: string | null }
interface PasteGroup { id: string; name: string; sectorId: string; receivedFrom: "CPF Group" | "Other Groups" }
interface Meta {
  sectors: Sector[];
  pasteGroups: PasteGroup[];
}

const TABS = [
  { id: "groups", label: "Groups", hint: "WhatsApp groups for the occurrence book" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function GroupsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16" cy="9" r="2" />
      <path d="M4.5 18.5c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6" />
      <path d="M14 15.2c1.3-.5 2.6-.4 3.8.5 1 .7 1.6 1.7 1.9 2.8" />
    </svg>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const profile = authStore.getProfile();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>("groups");
  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [receivedFrom, setReceivedFrom] = useState<"CPF Group" | "Other Groups">("CPF Group");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const meta = useQuery({
    queryKey: ["admin.ob.meta"],
    queryFn: () => adminFetch<Meta>("/admin/ob/meta"),
  });

  const tabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q));
  }, [query]);

  const active = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id;
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

  return (
    <div className="-m-4 flex min-h-full bg-[#f3f3f3] md:-m-6">
      <aside className="flex w-56 shrink-0 flex-col border-r border-black/10 bg-[#f7f7f7] sm:w-64">
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
            const selected = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${selected ? "bg-black/10 font-semibold text-gray-900" : "text-gray-800 hover:bg-black/5"}`}
                onClick={() => setTab(item.id)}
              >
                <span className="text-gray-700"><GroupsIcon /></span>
                {item.label}
              </button>
            );
          })}
          {tabs.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No settings match.</p>}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto px-5 py-6 sm:px-10 sm:py-8">
        {active === "groups" && (
          <div className="mx-auto max-w-3xl">
            <p className="text-sm text-gray-500">Settings &gt; Groups</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">Groups</h1>
            <p className="mt-2 max-w-xl text-sm text-gray-600">
              WhatsApp groups the desk pastes into the occurrence book. Add a group here, then choose it when you log an incident.
            </p>
            {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

            <section className="mt-6 rounded-lg border border-black/10 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Add a group</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

            <section className="mt-4 overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
              <h2 className="border-b border-black/5 px-5 py-4 text-base font-semibold text-gray-900">Saved groups</h2>
              {meta.isLoading && <p className="px-5 py-4 text-sm text-gray-500">Loading…</p>}
              {meta.isError && <p className="px-5 py-4 text-sm text-red-700">The group list could not be loaded.</p>}
              {!meta.isLoading && groups.length === 0 && <p className="px-5 py-4 text-sm text-gray-500">No groups yet.</p>}
              <ul>
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
      </div>
    </div>
  );
}
