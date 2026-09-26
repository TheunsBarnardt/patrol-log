import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DANGER_LEVELS,
  OB_CATEGORIES,
  OB_CONCLUSIONS,
  OB_INJURY_TAGS,
  OB_POI_GENDERS,
  OB_RECEIVED_FROM,
  OB_SERVICES,
  OB_TAGS,
  OB_TIME_BANDS,
  OB_VOI_COLOURS,
  OB_VOI_SHAPES,
  dangerForTypes,
  dangerMeta,
  obTypesFor,
  requiresAttendance,
  type ObAttendance,
  type ObCategory,
  type ObDangerLevel,
  type ObPhase,
} from "@patrol-log/shared";
import { adminFetch, authStore } from "../lib/api";
import { DataTable, PageHeader, RowActions } from "../components/DataTable";
import { LocationMap } from "../components/LocationMap";
import { MultiSelect } from "../components/MultiSelect";
import { Btn, Field, inputCls, selectCls } from "../components/Modal";

interface Suburb { id: string; name: string; aliases: string[] }
interface Company { id: string; name: string }
interface Sector { id: string; name: string; code: string | null }
interface OnPatrol { id: string; callSign: string; name: string; sectorId: string }
interface PatrolOption { id: string; label: string; sectorId: string }
interface Meta {
  suburbs: Suburb[];
  securityCompanies: Company[];
  sectors: Sector[];
  onPatrol: OnPatrol[];
  patrols: PatrolOption[];
  canMaintainCompanies: boolean;
}
interface ListRow {
  id: string;
  obNumber: string;
  status: "active" | "closed";
  category: ObCategory;
  phase: ObPhase | null;
  dangerLevel: ObDangerLevel | null;
  occurredAt: string;
  timeOfDay: string;
  dayOfWeek: string;
  suburbName: string | null;
  street: string;
  callSign: string;
  conclusion: string | null;
  primaryType: string;
  primaryCode: string | null;
  typeCount: number;
}
interface VehicleForm { colour: string; shape: string; make: string; model: string; registration: string; features: string }
interface PoiForm { gender: string; clothing: string; direction: string }
interface PatientForm { injuryTag: string; note: string }
interface Sighting { id: string; suburbId: string | null; street: string; seenAt: string; note: string | null; callSign: string }
interface EntryDetail {
  id: string;
  obNumber: string;
  status: "active" | "closed";
  sectorId: string;
  category: ObCategory;
  phase: ObPhase | null;
  date: string;
  time: string;
  suburbId: string | null;
  street: string;
  lat: number | null;
  lng: number | null;
  description: string;
  actionDetails: string;
  receivedFrom: string[];
  attendance: ObAttendance | null;
  conclusion: string | null;
  callSign: string;
  types: { key: string; isPrimary: boolean }[];
  services: { key: string; reference: string | null; otherName: string | null; securityCompanyId: string | null }[];
  responderIds: string[];
  responders: { id: string; callSign: string; name: string }[];
  patrolIds: string[];
  patrols: { id: string; label: string }[];
  tagKeys: string[];
  vehicles: VehicleForm[];
  persons: { kind: "poi" | "patient"; gender: string | null; clothing: string | null; direction: string | null; injuryTag: string | null; note: string | null }[];
  sightings: Sighting[];
}

interface FormState {
  sectorId: string;
  category: ObCategory;
  primaryKey: string;
  extraKeys: string[];
  phase: "" | ObPhase;
  date: string;
  time: string;
  receivedFrom: string[];
  attendance: "" | ObAttendance;
  suburbId: string;
  street: string;
  lat: string;
  lng: string;
  description: string;
  actionDetails: string;
  tagKeys: string[];
  responderIds: string[];
  patrolIds: string[];
  serviceOn: Record<string, boolean>;
  serviceRef: Record<string, string>;
  otherName: string;
  companyIds: string[];
  vehicles: VehicleForm[];
  pois: PoiForm[];
  patients: PatientForm[];
  conclusion: string;
}

const emptyVehicle = (): VehicleForm => ({ colour: "", shape: "", make: "", model: "", registration: "", features: "" });

function sastNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

function emptyForm(sectorId: string): FormState {
  const clock = sastNow();
  return {
    sectorId,
    category: "criminal",
    primaryKey: "",
    extraKeys: [],
    phase: "",
    date: clock.date,
    time: clock.time,
    receivedFrom: [],
    attendance: "",
    suburbId: "",
    street: "",
    lat: "",
    lng: "",
    description: "",
    actionDetails: "",
    tagKeys: [],
    responderIds: [],
    patrolIds: [],
    serviceOn: {},
    serviceRef: {},
    otherName: "",
    companyIds: [],
    vehicles: [emptyVehicle()],
    pois: [],
    patients: [],
    conclusion: "",
  };
}

function fromEntry(entry: EntryDetail): FormState {
  const primary = entry.types.find((t) => t.isPrimary) ?? entry.types[0];
  const serviceOn: Record<string, boolean> = {};
  const serviceRef: Record<string, string> = {};
  const companyIds: string[] = [];
  let otherName = "";
  for (const s of entry.services) {
    if (s.key === "security" && s.securityCompanyId) companyIds.push(s.securityCompanyId);
    else {
      serviceOn[s.key] = true;
      if (s.reference) serviceRef[s.key] = s.reference;
      if (s.otherName) otherName = s.otherName;
    }
  }
  return {
    sectorId: entry.sectorId,
    category: entry.category,
    primaryKey: primary?.key ?? "",
    extraKeys: entry.types.filter((t) => t.key !== primary?.key).map((t) => t.key),
    phase: entry.phase ?? "",
    date: entry.date,
    time: entry.time,
    receivedFrom: entry.receivedFrom ?? [],
    attendance: entry.attendance ?? "",
    suburbId: entry.suburbId ?? "",
    street: entry.street ?? "",
    lat: entry.lat == null ? "" : String(entry.lat),
    lng: entry.lng == null ? "" : String(entry.lng),
    description: entry.description ?? "",
    actionDetails: entry.actionDetails ?? "",
    tagKeys: entry.tagKeys ?? [],
    responderIds: entry.responderIds ?? [],
    patrolIds: entry.patrolIds ?? [],
    serviceOn,
    serviceRef,
    otherName,
    companyIds,
    vehicles: entry.vehicles.length ? entry.vehicles.map((v) => ({ ...emptyVehicle(), ...v, colour: v.colour ?? "", shape: v.shape ?? "", make: v.make ?? "", model: v.model ?? "", registration: v.registration ?? "", features: v.features ?? "" })) : [emptyVehicle()],
    pois: entry.persons.filter((p) => p.kind === "poi").map((p) => ({ gender: p.gender ?? "", clothing: p.clothing ?? "", direction: p.direction ?? "" })),
    patients: entry.persons.filter((p) => p.kind === "patient").map((p) => ({ injuryTag: p.injuryTag ?? "", note: p.note ?? "" })),
    conclusion: entry.conclusion ?? "",
  };
}

function codeWithPhase(code: string | null, phase: ObPhase | null): string {
  if (!code) return "";
  if (!phase) return code;
  const letter = phase === "alpha" ? "A" : "B";
  return code.endsWith("C") ? `${code} ${letter}` : `${code}${letter}`;
}

function dangerClass(level: ObDangerLevel | null): string {
  if (level === "leave_to_police") return "bg-red-100 text-red-800";
  if (level === "caution") return "bg-amber-100 text-amber-900";
  if (level === "respond") return "bg-emerald-100 text-emerald-800";
  if (level === "no_response") return "bg-blue-100 text-blue-900";
  return "bg-gray-100 text-gray-600";
}

export function OccurrenceBookPage() {
  const qc = useQueryClient();
  const profile = authStore.getProfile();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "closed">("active");
  const [mode, setMode] = useState<"list" | "new" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(profile?.sector_id ?? ""));
  const [hydrated, setHydrated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const [newSuburb, setNewSuburb] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [seenDate, setSeenDate] = useState("");
  const [seenTime, setSeenTime] = useState("");
  const [seenStreet, setSeenStreet] = useState("");
  const [seenNote, setSeenNote] = useState("");

  const meta = useQuery({
    queryKey: ["admin.ob.meta"],
    queryFn: () => adminFetch<Meta>("/admin/ob/meta"),
  });

  const list = useQuery({
    queryKey: ["admin.ob.entries", status, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      return adminFetch<{ results: ListRow[] }>(`/admin/ob/entries${qs ? `?${qs}` : ""}`);
    },
    enabled: mode === "list",
  });

  const detail = useQuery({
    queryKey: ["admin.ob.entry", editingId],
    queryFn: () => adminFetch<EntryDetail>(`/admin/ob/entries/${editingId}`),
    enabled: mode === "edit" && !!editingId,
  });

  useEffect(() => {
    if (mode === "edit" && detail.data && detail.data.id !== hydrated) {
      setForm(fromEntry(detail.data));
      setHydrated(detail.data.id);
      setError("");
    }
  }, [mode, detail.data, hydrated]);

  const types = obTypesFor(form.category);
  const filteredTypes = types.filter((t) => {
    const q = typeQuery.trim().toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q);
  });
  const typeKeys = [form.primaryKey, ...form.extraKeys.filter((k) => k && k !== form.primaryKey)].filter(Boolean);
  const danger = form.category === "criminal" && form.phase ? dangerForTypes(typeKeys, form.phase) : null;
  const dangerInfo = dangerMeta(danger);
  const mustAttend = requiresAttendance(form.category, typeKeys);
  const isCommence = detail.data?.types.some((t) => t.key === "commence_shift") ?? false;
  const onPatrol = (meta.data?.onPatrol ?? []).filter((p) => !form.sectorId || p.sectorId === form.sectorId);
  const memberOptions = [
    ...onPatrol.map((p) => ({ value: p.id, label: `${p.callSign} · ${p.name}` })),
    ...(mode === "edit" ? detail.data?.responders ?? [] : [])
      .filter((p) => !onPatrol.some((row) => row.id === p.id))
      .map((p) => ({ value: p.id, label: `${p.callSign} · ${p.name}` })),
  ];
  const patrolOptions = [
    ...(meta.data?.patrols ?? [])
      .filter((p) => !form.sectorId || p.sectorId === form.sectorId)
      .map((p) => ({ value: p.id, label: p.label })),
    ...(mode === "edit" ? detail.data?.patrols ?? [] : [])
      .filter((p) => !(meta.data?.patrols ?? []).some((row) => row.id === p.id))
      .map((p) => ({ value: p.id, label: p.label })),
  ];

  function startNew() {
    const sectorId = profile?.sector_id || meta.data?.sectors[0]?.id || "";
    setForm(emptyForm(sectorId));
    setEditingId(null);
    setHydrated(null);
    setError("");
    setTypeQuery("");
    setMode("new");
  }

  function backToList() {
    setMode("list");
    setEditingId(null);
    setHydrated(null);
    setError("");
    void qc.invalidateQueries({ queryKey: ["admin.ob.entries"] });
  }

  function payload() {
    const services: { key: string; reference: string | null; other_name: string | null; security_company_id?: string }[] =
      OB_SERVICES.filter((s) => form.serviceOn[s.key]).map((s) => ({
        key: s.key,
        reference: form.serviceRef[s.key] || null,
        other_name: s.key === "other" ? form.otherName : null,
      }));
    for (const id of form.companyIds) {
      services.push({ key: "security", reference: null, other_name: null, security_company_id: id });
    }
    return {
      sector_id: form.sectorId || undefined,
      category: form.category,
      type_keys: typeKeys,
      phase: form.category === "criminal" ? form.phase || null : null,
      date: form.date,
      time: form.time,
      received_from: form.receivedFrom,
      attendance: form.attendance || null,
      suburb_id: form.suburbId || null,
      street: form.street,
      lat: form.lat.trim() === "" ? null : Number(form.lat),
      lng: form.lng.trim() === "" ? null : Number(form.lng),
      description: form.description,
      action_details: form.actionDetails,
      tag_keys: form.tagKeys,
      responder_ids: form.responderIds,
      patrol_ids: form.patrolIds,
      services,
      vehicles: form.vehicles,
      persons: [
        ...form.pois.map((p) => ({ kind: "poi", gender: p.gender, clothing: p.clothing, direction: p.direction })),
        ...form.patients.map((p) => ({ kind: "patient", injury_tag: p.injuryTag, note: p.note })),
      ],
    };
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (mode === "new") {
        const created = await adminFetch<EntryDetail>("/admin/ob/entries", { method: "POST", body: JSON.stringify(payload()) });
        setEditingId(created.id);
        setHydrated(null);
        setMode("edit");
        void qc.invalidateQueries({ queryKey: ["admin.ob.entry", created.id] });
      } else if (editingId) {
        await adminFetch(`/admin/ob/entries/${editingId}`, { method: "PATCH", body: JSON.stringify(payload()) });
        setHydrated(null);
        await qc.invalidateQueries({ queryKey: ["admin.ob.entry", editingId] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function closeEntry() {
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      await adminFetch(`/admin/ob/entries/${editingId}`, { method: "PATCH", body: JSON.stringify(payload()) });
      await adminFetch(`/admin/ob/entries/${editingId}/close`, {
        method: "POST",
        body: JSON.stringify({ conclusion: form.conclusion, action_details: form.actionDetails }),
      });
      setHydrated(null);
      await qc.invalidateQueries({ queryKey: ["admin.ob.entry", editingId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close");
    } finally {
      setSaving(false);
    }
  }

  async function logShift() {
    setError("");
    try {
      await adminFetch("/admin/ob/commence-shift", { method: "POST", body: JSON.stringify({ sector_id: profile?.sector_id }) });
      void qc.invalidateQueries({ queryKey: ["admin.ob.entries"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log the shift");
    }
  }

  async function addSuburb() {
    const name = newSuburb.trim();
    if (name.length < 2) return;
    setError("");
    try {
      const row = await adminFetch<Suburb>("/admin/ob/suburbs", { method: "POST", body: JSON.stringify({ name }) });
      setNewSuburb("");
      setForm((f) => ({ ...f, suburbId: row.id }));
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add suburb");
    }
  }

  async function addCompany() {
    const name = newCompany.trim();
    if (name.length < 2) return;
    setError("");
    try {
      const row = await adminFetch<Company>("/admin/ob/companies", { method: "POST", body: JSON.stringify({ name }) });
      setNewCompany("");
      setForm((f) => ({ ...f, companyIds: [...f.companyIds, row.id] }));
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add company");
    }
  }

  async function addSighting() {
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      await adminFetch(`/admin/ob/entries/${editingId}/sightings`, {
        method: "POST",
        body: JSON.stringify({
          date: seenDate || form.date,
          time: seenTime || form.time,
          suburb_id: form.suburbId || null,
          street: seenStreet || form.street,
          note: seenNote,
        }),
      });
      setSeenNote("");
      setHydrated(null);
      await qc.invalidateQueries({ queryKey: ["admin.ob.entry", editingId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the sighting");
    } finally {
      setSaving(false);
    }
  }

  const band = useMemo(() => {
    const match = form.time.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const mins = Number(match[1]) * 60 + Number(match[2]);
    return OB_TIME_BANDS.find((b) => mins >= b.fromMin && mins < b.toMin) ?? null;
  }, [form.time]);

  if (mode !== "list") {
    const heading = mode === "new" ? "Log incident" : detail.data?.obNumber ?? "Incident";
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button type="button" className="text-sm font-medium text-gray-600 hover:text-gray-900" onClick={backToList}>
            ← Back to the book
          </button>
          <h1 className="text-lg font-bold text-gray-900">{heading}</h1>
          {detail.data && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${detail.data.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`}>
              {detail.data.status === "active" ? "Active" : "Closed"}
            </span>
          )}
        </div>
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {mode === "edit" && detail.isLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {isCommence ? (
          <div className="rounded-xl border bg-white p-4 sm:p-6">
            <p className="mb-4 text-sm text-gray-600">Commence Shift for {detail.data?.callSign}. This is a book row, not a patrol.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" required><input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Time" required><input className={inputCls} type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Incident</h2>
              {(meta.data?.sectors.length ?? 0) > 1 && (
                <Field label="Sector" required>
                  <select className={selectCls} value={form.sectorId} disabled={mode === "edit"} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
                    {meta.data?.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Category" required>
                <select
                  className={selectCls}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as ObCategory, primaryKey: "", extraKeys: [], phase: "" })}
                >
                  {OB_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Primary type" required>
                <input className={`${inputCls} mb-2`} placeholder="Search types or codes" value={typeQuery} onChange={(e) => setTypeQuery(e.target.value)} />
                <select className={selectCls} value={form.primaryKey} onChange={(e) => setForm({ ...form, primaryKey: e.target.value, extraKeys: form.extraKeys.filter((k) => k !== e.target.value) })}>
                  <option value="">Choose a type</option>
                  {(typeQuery ? filteredTypes : types).map((t) => (
                    <option key={t.key} value={t.key}>{t.name}{t.code ? ` (${t.code})` : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Also happened (extra types)">
                <MultiSelect
                  searchable
                  placeholder="Choose extra types"
                  emptyText="No other types match"
                  options={types.filter((t) => t.key !== form.primaryKey).map((t) => ({ value: t.key, label: t.code ? `${t.name} (${t.code})` : t.name }))}
                  value={form.extraKeys}
                  onChange={(extraKeys) => setForm({ ...form, extraKeys })}
                />
              </Field>
              {form.category === "criminal" && (
                <Field label="Alpha or Bravo" required>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" name="phase" checked={form.phase === "alpha"} onChange={() => setForm({ ...form, phase: "alpha" })} /> Alpha — still happening</label>
                    <label className="flex items-center gap-2"><input type="radio" name="phase" checked={form.phase === "bravo"} onChange={() => setForm({ ...form, phase: "bravo" })} /> Bravo — already over</label>
                  </div>
                </Field>
              )}
              {dangerInfo && (
                <p className={`rounded-lg px-3 py-2 text-sm ${dangerClass(danger)}`}>
                  <strong>{dangerInfo.label}.</strong> {dangerInfo.instruction}
                </p>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Date" required><input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                <Field label="Estimated time" required><input className={inputCls} type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
              </div>
              {band && <p className="mb-4 text-xs text-gray-500">{band.label} ({band.range})</p>}
              <Field label="Received from" required>
                <MultiSelect
                  placeholder="Choose who it came from"
                  options={OB_RECEIVED_FROM.map((label) => ({ value: label, label }))}
                  value={form.receivedFrom}
                  onChange={(receivedFrom) => setForm({ ...form, receivedFrom })}
                />
              </Field>
              <Field label={mustAttend ? "CPF on scene (required)" : "CPF attendance"}>
                <select className={selectCls} value={form.attendance} onChange={(e) => setForm({ ...form, attendance: e.target.value as FormState["attendance"] })}>
                  <option value="">{mustAttend ? "Choose" : "Not set"}</option>
                  <option value="present">Present</option>
                  <option value="assisting">Assisting</option>
                  {!mustAttend && <option value="not_present">Not present — information only</option>}
                </select>
                {mustAttend && <p className="mt-1 text-xs text-gray-500">Emergencies, disasters and by-law are only logged if we were present or assisting.</p>}
              </Field>
            </section>

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Location</h2>
              <Field label="Suburb" required>
                <select className={selectCls} value={form.suburbId} onChange={(e) => setForm({ ...form, suburbId: e.target.value })}>
                  <option value="">Choose a suburb</option>
                  {meta.data?.suburbs.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.aliases.length ? ` (also ${s.aliases.join(", ")})` : ""}</option>
                  ))}
                </select>
              </Field>
              <div className="mb-4 flex gap-2">
                <input className={inputCls} placeholder="Add a suburb if it is missing" value={newSuburb} onChange={(e) => setNewSuburb(e.target.value)} />
                <Btn variant="ghost" onClick={() => void addSuburb()}>Add</Btn>
              </div>
              <Field label="Street number and name / complex">
                <input className={inputCls} value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
              </Field>
              {(mode === "new" || hydrated) && (
                <LocationMap
                  key={hydrated ?? "new"}
                  lat={form.lat}
                  lng={form.lng}
                  street={form.street}
                  suburbName={meta.data?.suburbs.find((s) => s.id === form.suburbId)?.name ?? ""}
                  onChange={(lat, lng) => setForm((current) => ({ ...current, lat, lng }))}
                />
              )}
            </section>

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Description</h2>
              <textarea className={inputCls} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </section>

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Vehicle of interest</h2>
              {form.vehicles.map((v, i) => (
                <div key={i} className="mb-3 grid gap-2 sm:grid-cols-2">
                  <select className={selectCls} value={v.colour} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, colour: e.target.value } : row) })}>
                    <option value="">Colour</option>
                    {OB_VOI_COLOURS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <select className={selectCls} value={v.shape} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, shape: e.target.value } : row) })}>
                    <option value="">Shape</option>
                    {OB_VOI_SHAPES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className={inputCls} placeholder="Make" value={v.make} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, make: e.target.value } : row) })} />
                  <input className={inputCls} placeholder="Model" value={v.model} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, model: e.target.value } : row) })} />
                  <input className={inputCls} placeholder="Registration" value={v.registration} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, registration: e.target.value } : row) })} />
                  <input className={inputCls} placeholder="Distinguishing features" value={v.features} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, features: e.target.value } : row) })} />
                </div>
              ))}
              <Btn variant="ghost" onClick={() => setForm({ ...form, vehicles: [...form.vehicles, emptyVehicle()] })}>+ Another vehicle</Btn>
            </section>

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Person of interest</h2>
              {form.pois.map((p, i) => (
                <div key={i} className="mb-3 grid gap-2 sm:grid-cols-3">
                  <select className={selectCls} value={p.gender} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, gender: e.target.value } : row) })}>
                    <option value="">Gender</option>
                    {OB_POI_GENDERS.map((g) => <option key={g}>{g}</option>)}
                  </select>
                  <input className={inputCls} placeholder="Clothing" value={p.clothing} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, clothing: e.target.value } : row) })} />
                  <input className={inputCls} placeholder="Direction of travel" value={p.direction} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, direction: e.target.value } : row) })} />
                </div>
              ))}
              <Btn variant="ghost" onClick={() => setForm({ ...form, pois: [...form.pois, { gender: "", clothing: "", direction: "" }] })}>+ Person</Btn>
            </section>

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Injured people</h2>
              <p className="mb-3 text-xs text-gray-500">P1–P4 describes that person, not how dangerous the scene is.</p>
              {form.patients.map((p, i) => (
                <div key={i} className="mb-3 grid gap-2 sm:grid-cols-2">
                  <select className={selectCls} value={p.injuryTag} onChange={(e) => setForm({ ...form, patients: form.patients.map((row, j) => j === i ? { ...row, injuryTag: e.target.value } : row) })}>
                    <option value="">Patient priority</option>
                    {OB_INJURY_TAGS.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.meaning}</option>)}
                  </select>
                  <input className={inputCls} placeholder="Note" value={p.note} onChange={(e) => setForm({ ...form, patients: form.patients.map((row, j) => j === i ? { ...row, note: e.target.value } : row) })} />
                </div>
              ))}
              <Btn variant="ghost" onClick={() => setForm({ ...form, patients: [...form.patients, { injuryTag: "", note: "" }] })}>+ Injured person</Btn>
              <div className="mt-4">
                <Field label="Tags">
                  <MultiSelect
                    placeholder="Choose tags"
                    options={OB_TAGS.map((t) => ({ value: t.key, label: t.label }))}
                    value={form.tagKeys}
                    onChange={(tagKeys) => setForm({ ...form, tagKeys })}
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Who reacted</h2>
              <Field label="Patrols that responded">
                <MultiSelect
                  placeholder="Choose patrols"
                  emptyText="No active patrols in this sector right now."
                  options={patrolOptions}
                  value={form.patrolIds}
                  onChange={(patrolIds) => setForm({ ...form, patrolIds })}
                />
              </Field>
              <Field label="CPF members on patrol">
                <MultiSelect
                  placeholder="Choose members"
                  emptyText="Nobody is on patrol in this sector right now."
                  options={memberOptions}
                  value={form.responderIds}
                  onChange={(responderIds) => setForm({ ...form, responderIds })}
                />
              </Field>
              <Field label="Services">
                <MultiSelect
                  placeholder="Choose services"
                  options={OB_SERVICES.map((s) => ({ value: s.key, label: s.label }))}
                  value={OB_SERVICES.filter((s) => form.serviceOn[s.key]).map((s) => s.key)}
                  onChange={(keys) => {
                    const serviceOn: Record<string, boolean> = {};
                    for (const key of keys) serviceOn[key] = true;
                    setForm({ ...form, serviceOn });
                  }}
                />
              </Field>
              {OB_SERVICES.filter((s) => form.serviceOn[s.key] && (s.referenceLabel || s.key === "other")).map((s) => (
                <div key={s.key} className="mb-3 grid gap-2 sm:grid-cols-2">
                  {s.referenceLabel && (
                    <Field label={s.referenceLabel}>
                      <input className={inputCls} value={form.serviceRef[s.key] ?? ""} onChange={(e) => setForm({ ...form, serviceRef: { ...form.serviceRef, [s.key]: e.target.value } })} />
                    </Field>
                  )}
                  {s.key === "other" && (
                    <Field label="Other service name">
                      <input className={inputCls} value={form.otherName} onChange={(e) => setForm({ ...form, otherName: e.target.value })} />
                    </Field>
                  )}
                </div>
              ))}
              <Field label="Security companies">
                <MultiSelect
                  placeholder="Choose security companies"
                  emptyText="No companies loaded yet."
                  options={(meta.data?.securityCompanies ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={form.companyIds}
                  onChange={(companyIds) => setForm({ ...form, companyIds })}
                />
              </Field>
              {meta.data?.canMaintainCompanies && (
                <div className="mb-4 flex gap-2">
                  <input className={inputCls} placeholder="Add a security company" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />
                  <Btn variant="ghost" onClick={() => void addCompany()}>Add</Btn>
                </div>
              )}
              <Field label="Action taken">
                <textarea className={inputCls} rows={3} value={form.actionDetails} onChange={(e) => setForm({ ...form, actionDetails: e.target.value })} />
              </Field>
            </section>

            {mode === "edit" && detail.data && (
              <section className="rounded-xl border bg-white p-4 sm:p-6">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">Last seen</h2>
                <ul className="mb-3 space-y-1 text-sm text-gray-700">
                  {detail.data.sightings.length === 0 && <li>No later sightings. The incident location is the last known place.</li>}
                  {detail.data.sightings.map((s) => (
                    <li key={s.id}>{s.seenAt} · {s.street || "no street"} · {s.callSign}{s.note ? ` — ${s.note}` : ""}</li>
                  ))}
                </ul>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={inputCls} type="date" value={seenDate} onChange={(e) => setSeenDate(e.target.value)} />
                  <input className={inputCls} type="time" value={seenTime} onChange={(e) => setSeenTime(e.target.value)} />
                  <input className={inputCls} placeholder="Street" value={seenStreet} onChange={(e) => setSeenStreet(e.target.value)} />
                  <input className={inputCls} placeholder="What was seen" value={seenNote} onChange={(e) => setSeenNote(e.target.value)} />
                </div>
                <div className="mt-2"><Btn variant="ghost" onClick={() => void addSighting()}>Add sighting</Btn></div>
              </section>
            )}

            <section className="rounded-xl border bg-white p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Close</h2>
              <Field label="Conclusion">
                <select className={selectCls} value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })}>
                  <option value="">Leave active</option>
                  {OB_CONCLUSIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <p className="text-xs text-gray-500">Photos are not on this form yet. They will be stored on the incident once file upload is in place.</p>
            </section>

            <div className="flex flex-wrap justify-end gap-2">
              <Btn variant="ghost" onClick={backToList}>Cancel</Btn>
              <Btn onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : mode === "new" ? "Save incident" : "Save changes"}</Btn>
              {mode === "edit" && form.conclusion && (
                <Btn variant="danger" onClick={() => void closeEntry()} disabled={saving}>Close incident</Btn>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="OB Book"
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => void logShift()}>Log Commence Shift</Btn>
            <Btn onClick={startNew}>+ Log incident</Btn>
          </div>
        }
      />
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {meta.isError && <p className="mb-4 text-sm text-red-700">The book lists could not be loaded. Apply the database update (ob book tables) and reload.</p>}
      <div className="mb-4 flex gap-2 text-sm">
        {(["active", "closed", ""] as const).map((value) => (
          <button
            key={value || "all"}
            type="button"
            className={`rounded-full px-3 py-1 ${status === value ? "bg-gray-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}
            onClick={() => setStatus(value)}
          >
            {value === "active" ? "Active" : value === "closed" ? "Closed" : "All"}
          </button>
        ))}
      </div>
      <p className="mb-4 max-w-2xl text-sm text-gray-600">
        Numbers are given on save, per sector and year, for example S1/215/2026. Crime can be logged even if nobody was on scene. Emergencies only if CPF was present or assisting.
      </p>
      {list.isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={list.data?.results ?? []}
          keyExtractor={(r) => r.id}
          emptyMessage="No incidents in the book yet"
          columns={[
            { header: "OB", render: (r) => <span className="font-medium">{r.obNumber}</span> },
            { header: "When", render: (r) => <span>{r.occurredAt.slice(0, 16)}<br /><span className="text-xs text-gray-500">{r.dayOfWeek} · {r.timeOfDay}</span></span> },
            { header: "Where", render: (r) => <span>{r.suburbName ?? "—"}{r.street ? ` · ${r.street}` : ""}</span> },
            {
              header: "Type",
              render: (r) => (
                <span>
                  {r.primaryType}
                  {r.primaryCode ? ` (${codeWithPhase(r.primaryCode, r.phase)})` : ""}
                  {r.typeCount > 1 ? ` +${r.typeCount - 1}` : ""}
                </span>
              ),
            },
            {
              header: "Danger",
              render: (r) => r.dangerLevel
                ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dangerClass(r.dangerLevel)}`}>{DANGER_LEVELS.find((d) => d.key === r.dangerLevel)?.label}</span>
                : <span className="text-gray-400">—</span>,
            },
            { header: "Status", render: (r) => r.status === "active" ? "Active" : (r.conclusion ?? "Closed") },
            {
              header: "",
              className: "text-right",
              render: (r) => <RowActions onEdit={() => { setEditingId(r.id); setHydrated(null); setMode("edit"); }} />,
            },
          ]}
        />
      )}
    </>
  );
}
