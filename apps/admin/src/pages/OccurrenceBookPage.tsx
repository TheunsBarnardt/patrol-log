import { extractIncident, joinMessages, type NeedleFill } from "../lib/needle";
import { adminFetch, authStore } from "../lib/api";
import { DataTable, PageHeader, RowActions } from "../components/DataTable";
import { LocationMap } from "../components/LocationMap";
import { MultiSelect } from "../components/MultiSelect";
import { Btn, Field, inputCls, selectCls } from "../components/Modal";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DANGER_LEVELS,
  OB_CATEGORIES,
  OB_CONCLUSIONS,
  OB_ETHNICITIES,
  OB_INJURY_TAGS,
  OB_PHONETIC_CODES,
  OB_POI_GENDERS,
  OB_RECEIVED_FROM,
  OB_SERVICES,
  OB_TAGS,
  OB_TIME_BANDS,
  OB_VOI_COLOURS,
  OB_VOI_SHAPES,
  dangerForTypes,
  dangerMeta,
  normalizeMessageBody,
  obFormSections,
  obType,
  obTypesFor,
  requiresAttendance,
  type ObAttendance,
  type ObCategory,
  type ObDangerLevel,
  type ObPhase,
} from "@patrol-log/shared";

interface Suburb { id: string; name: string; aliases: string[] }
interface Company { id: string; name: string }
interface Sector { id: string; name: string; code: string | null }
interface Member { id: string; callSign: string; name: string; phone: string | null; sectorId: string; onPatrol: boolean }
interface PatrolOption { id: string; label: string; sectorId: string }
interface PasteGroup { id: string; name: string; sectorId: string; receivedFrom: "CPF Group" | "Other Groups" }
interface ResidentRef { id: string; name: string; phone: string; address: string; sectorId: string }
interface NeedleExampleRow {
  id: string;
  passage: string;
  vote: "up" | "down";
  notes: string;
  needleFill: Partial<NeedleFill>;
  correctedFill: Partial<NeedleFill> | null;
  createdAt: string;
}
interface Meta {
  suburbs: Suburb[];
  securityCompanies: Company[];
  sectors: Sector[];
  members: Member[];
  residents: ResidentRef[];
  patrols: PatrolOption[];
  tags: { key: string; label: string }[];
  canMaintainCompanies: boolean;
  pasteGroups: PasteGroup[];
  needleExamples: NeedleExampleRow[];
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
  description: string;
  conclusion: string | null;
  primaryType: string;
  primaryCode: string | null;
  typeCount: number;
  source: "manual" | "paste";
  messageCount: number;
}
interface StoredMessage { id: string; groupId: string | null; groupName: string; body: string; createdAt: string }
interface DraftMessage { key: string; body: string; groupId: string }
interface VehicleForm { colour: string; shape: string; make: string; model: string; registration: string; features: string; name: string; identifier: string }
interface PoiForm { gender: string; clothing: string; direction: string; name: string; ethnicity: string; identifier: string }
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
  source: "manual" | "paste";
  messages: StoredMessage[];
  types: { key: string; isPrimary: boolean }[];
  services: { key: string; reference: string | null; otherName: string | null; securityCompanyId: string | null }[];
  responderIds: string[];
  responders: { id: string; callSign: string; name: string }[];
  patrolIds: string[];
  patrols: { id: string; label: string }[];
  tagKeys: string[];
  vehicles: VehicleForm[];
  persons: { kind: "poi" | "patient"; gender: string | null; clothing: string | null; direction: string | null; injuryTag: string | null; note: string | null; name: string | null; ethnicity: string | null; identifier: string | null }[];
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

const emptyVehicle = (): VehicleForm => ({ colour: "", shape: "", make: "", model: "", registration: "", features: "", name: "", identifier: "" });
const emptyPoi = (): PoiForm => ({ gender: "", clothing: "", direction: "", name: "", ethnicity: "", identifier: "" });

function vehicleFilled(rows: VehicleForm[]): boolean {
  return rows.some((row) => row.colour || row.shape || row.make || row.model || row.registration || row.features || row.name || row.identifier);
}

function poiFilled(rows: PoiForm[]): boolean {
  return rows.some((row) => row.gender || row.clothing || row.direction || row.name || row.ethnicity || row.identifier);
}

function patientFilled(rows: PatientForm[]): boolean {
  return rows.some((row) => row.injuryTag || row.note);
}

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
    vehicles: entry.vehicles.length ? entry.vehicles.map((v) => ({ ...emptyVehicle(), ...v, colour: v.colour ?? "", shape: v.shape ?? "", make: v.make ?? "", model: v.model ?? "", registration: v.registration ?? "", features: v.features ?? "", name: v.name ?? "", identifier: v.identifier ?? "" })) : [emptyVehicle()],
    pois: entry.persons.filter((p) => p.kind === "poi").map((p) => ({ ...emptyPoi(), gender: p.gender ?? "", clothing: p.clothing ?? "", direction: p.direction ?? "", name: p.name ?? "", ethnicity: p.ethnicity ?? "", identifier: p.identifier ?? "" })),
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

function FormPane({ label, blurb, children }: { label: string; blurb?: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-1 flex-col">
      <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">{label}</h2>
      {blurb && <p className="mt-2 max-w-3xl text-sm text-gray-600">{blurb}</p>}
      <div className="mt-6 w-full flex-1 space-y-4">{children}</div>
    </div>
  );
}

function AccordionSection({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return <FormPane label={title}>{children}</FormPane>;
}

function applyFill(
  form: FormState,
  fill: NeedleFill,
  first: boolean,
  sectorId: string,
  receivedFrom: string[],
  previousDescription: string,
): { form: FormState; autoDescription: string } {
  const next = { ...form, tagKeys: [...form.tagKeys], extraKeys: [...form.extraKeys], receivedFrom: [...form.receivedFrom] };
  let description = fill.description;
  if (fill.contactName || fill.contactPhone) {
    const contactLine = `Contact: ${[fill.contactName, fill.contactPhone].filter(Boolean).join(" ")}`.trim();
    if (!description.toLowerCase().includes("contact:")) description = `${description}\n\n${contactLine}`.trim();
  }
  if (fill.directoryHits.length) {
    const hits = fill.directoryHits.map((hit) => `${hit.kind === "resident" ? "Resident" : "Member"} ${hit.name}${hit.callSign ? ` (${hit.callSign})` : ""}`).join("; ");
    if (!description.toLowerCase().includes("directory:")) description = `${description}\nDirectory: ${hits}`.trim();
  }
  if (!next.description || next.description === previousDescription) next.description = description;
  if (first && sectorId) next.sectorId = sectorId;
  if (next.receivedFrom.length === 0 && receivedFrom.length) next.receivedFrom = receivedFrom;
  if (!next.primaryKey && fill.incidentKey) {
    const type = obType(fill.incidentKey);
    if (type) {
      next.category = type.category;
      next.primaryKey = type.key;
      next.extraKeys = next.extraKeys.filter((key) => key !== type.key);
    }
  }
  if (next.category === "criminal" && !next.phase && fill.phase) next.phase = fill.phase;
  if (!next.suburbId && fill.suburbId) next.suburbId = fill.suburbId;
  if (!next.street && fill.street) next.street = fill.street;
  if (first && fill.date) next.date = fill.date;
  if (first && fill.time) next.time = fill.time;
  if (!next.attendance && fill.attendance) next.attendance = fill.attendance;
  for (const tag of fill.tagKeys) {
    if (!next.tagKeys.includes(tag)) next.tagKeys = [...next.tagKeys, tag];
  }
  if (fill.vehicle && !vehicleFilled(next.vehicles)) {
    next.vehicles = [{
      ...emptyVehicle(),
      colour: fill.vehicle.colour,
      shape: fill.vehicle.shape,
      make: fill.vehicle.make,
      model: fill.vehicle.model,
      registration: fill.vehicle.registration,
    }];
  }
  const people = fill.persons.length ? fill.persons : fill.person ? [fill.person] : [];
  if (people.length && !poiFilled(next.pois)) {
    next.pois = people.map((person) => ({
      ...emptyPoi(),
      gender: person.gender,
      clothing: person.clothing,
      direction: person.direction,
      name: person.name,
      ethnicity: person.ethnicity,
    }));
  }
  return { form: next, autoDescription: next.description === description ? description : previousDescription };
}

function formAsCorrectedFill(form: FormState): Partial<NeedleFill> {
  const attendance = form.attendance === "present" || form.attendance === "assisting" ? form.attendance : "";
  return {
    incidentKey: form.primaryKey || null,
    tagKeys: form.tagKeys,
    phase: form.phase || "",
    suburbId: form.suburbId || null,
    street: form.street,
    description: form.description,
    date: form.date,
    time: form.time,
    attendance,
    vehicle: vehicleFilled(form.vehicles)
      ? {
          colour: form.vehicles[0]!.colour,
          shape: form.vehicles[0]!.shape,
          make: form.vehicles[0]!.make,
          model: form.vehicles[0]!.model,
          registration: form.vehicles[0]!.registration,
        }
      : null,
    persons: form.pois.filter((p) => p.gender || p.clothing || p.name || p.ethnicity).map((p) => ({
      gender: p.gender,
      clothing: p.clothing,
      direction: p.direction,
      name: p.name,
      ethnicity: p.ethnicity,
    })),
    person: form.pois[0]
      ? {
          gender: form.pois[0].gender,
          clothing: form.pois[0].clothing,
          direction: form.pois[0].direction,
          name: form.pois[0].name,
          ethnicity: form.pois[0].ethnicity,
        }
      : null,
  };
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
  const [newTag, setNewTag] = useState("");
  const [seenDate, setSeenDate] = useState("");
  const [seenTime, setSeenTime] = useState("");
  const [seenStreet, setSeenStreet] = useState("");
  const [seenNote, setSeenNote] = useState("");
  const [openSection, setOpenSection] = useState("incident");
  function toggleSection(id: string) {
    setOpenSection(id);
  }
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [pasteBody, setPasteBody] = useState("");
  const [pasteGroupId, setPasteGroupId] = useState("");
  const [filled, setFilled] = useState(false);
  const [autoDescription, setAutoDescription] = useState("");
  const [filling, setFilling] = useState(false);
  const [lastNeedle, setLastNeedle] = useState<{
    passage: string;
    messages: { groupName: string; body: string }[];
    fill: NeedleFill;
  } | null>(null);
  const [trainingNote, setTrainingNote] = useState("");
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingSaved, setTrainingSaved] = useState<"up" | "down" | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftMemberId, setShiftMemberId] = useState("");
  const [shiftSector, setShiftSector] = useState("");
  const [shiftDate, setShiftDate] = useState(() => sastNow().date);
  const [shiftFrom, setShiftFrom] = useState("");
  const [shiftTo, setShiftTo] = useState("");

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

  const activeEntries = useQuery({
    queryKey: ["admin.ob.entries", "active", "picker"],
    queryFn: () => adminFetch<{ results: ListRow[] }>("/admin/ob/entries?status=active"),
    enabled: mode !== "list",
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
  const sections = obFormSections(typeKeys);
  const showVehicle = sections.vehicle || vehicleFilled(form.vehicles);
  const showPerson = sections.person || poiFilled(form.pois);
  const showInjured = sections.injured || patientFilled(form.patients);
  useEffect(() => {
    if ((openSection === "vehicle" && !showVehicle) || (openSection === "person" && !showPerson) || (openSection === "injured" && !showInjured)) {
      setOpenSection("incident");
    }
  }, [openSection, showVehicle, showInjured, showPerson]);
  const isCommence = detail.data?.types.some((t) => t.key === "commence_shift") ?? false;
  const isStandDown = detail.data?.types.some((t) => t.key === "stand_down") ?? false;
  const isShiftRow = isCommence || isStandDown;
  const members = (meta.data?.members ?? [])
    .filter((p) => !form.sectorId || p.sectorId === form.sectorId)
    .slice()
    .sort((a, b) => Number(b.onPatrol) - Number(a.onPatrol) || a.callSign.localeCompare(b.callSign));
  const memberOptions = [
    ...members.map((p) => ({
      value: p.id,
      label: p.onPatrol ? `${p.callSign} · ${p.name} · on patrol` : `${p.callSign} · ${p.name}`,
    })),
    ...(mode === "edit" ? detail.data?.responders ?? [] : [])
      .filter((p) => !members.some((row) => row.id === p.id))
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
  const showForm = mode === "edit" || filled;
  const entryOpen = mode === "new" || detail.data?.status === "active";
  const pasteGroups = meta.data?.pasteGroups ?? [];
  const storedMessages = detail.data?.messages ?? [];
  const formTabs = useMemo(() => {
    const tabs: { id: string; label: string; secondary?: boolean }[] = [
      { id: "incident", label: "Incident" },
      { id: "location", label: "Location" },
      { id: "description", label: "Description" },
    ];
    if (showVehicle) tabs.push({ id: "vehicle", label: "Vehicle" });
    if (showPerson) tabs.push({ id: "person", label: "Person" });
    if (showInjured) tabs.push({ id: "injured", label: "Injured" });
    tabs.push({ id: "tags", label: "Tags" }, { id: "reacted", label: "Who reacted" });
    if (mode === "edit" && detail.data && !isShiftRow) tabs.push({ id: "seen", label: "Last seen" });
    tabs.push({ id: "close", label: "Close" });
    tabs.push({ id: "ai", label: "AI assist", secondary: true });
    return tabs;
  }, [showVehicle, showPerson, showInjured, mode, detail.data, isShiftRow]);

  function startNew() {
    const sectorId = profile?.sector_id || meta.data?.sectors[0]?.id || "";
    setForm(emptyForm(sectorId));
    setEditingId(null);
    setHydrated(null);
    setError("");
    setTypeQuery("");
    setOpenSection("incident");
    setDrafts([]);
    setPasteBody("");
    setFilled(true);
    setAutoDescription("");
    setLastNeedle(null);
    setTrainingSaved(null);
    setTrainingNote("");
    setMode("new");
  }

  function chooseEntry(id: string) {
    if (!id) {
      const sectorId = profile?.sector_id || meta.data?.sectors[0]?.id || "";
      setForm(emptyForm(sectorId));
      setEditingId(null);
      setHydrated(null);
      setFilled(true);
      setOpenSection("incident");
      setAutoDescription("");
      setLastNeedle(null);
      setTrainingSaved(null);
      setMode("new");
      setError("");
      return;
    }
    setEditingId(id);
    setHydrated(null);
    setFilled(true);
    setLastNeedle(null);
    setTrainingSaved(null);
    setMode("edit");
    setError("");
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
        ...form.pois.map((p) => ({ kind: "poi", gender: p.gender, clothing: p.clothing, direction: p.direction, name: p.name, ethnicity: p.ethnicity, identifier: p.identifier })),
        ...form.patients.map((p) => ({ kind: "patient", injury_tag: p.injuryTag, note: p.note })),
      ],
    };
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (mode === "new") {
        const created = await adminFetch<EntryDetail>("/admin/ob/entries", {
          method: "POST",
          body: JSON.stringify({
            ...payload(),
            ...(drafts.length ? { messages: drafts.map((draft) => ({ body: draft.body, group_id: draft.groupId })) } : {}),
          }),
        });
        setDrafts([]);
        setEditingId(created.id);
        setHydrated(null);
        setFilled(true);
        setMode("edit");
        void qc.invalidateQueries({ queryKey: ["admin.ob.entry", created.id] });
      } else if (editingId) {
        if (drafts.length) {
          await adminFetch(`/admin/ob/entries/${editingId}/messages`, {
            method: "POST",
            body: JSON.stringify({ messages: drafts.map((draft) => ({ body: draft.body, group_id: draft.groupId })) }),
          });
          setDrafts([]);
        }
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

  async function addDraft() {
    const body = pasteBody.trim();
    if (!pasteGroupId || !body) {
      setError("Choose a group and paste a message.");
      return;
    }
    const folded = normalizeMessageBody(body);
    const onList = drafts.some((draft) => normalizeMessageBody(draft.body) === folded)
      || (detail.data?.messages ?? []).some((message) => normalizeMessageBody(message.body) === folded);
    if (onList) {
      setError("That message is already on this list.");
      return;
    }
    setError("");
    try {
      const check = await adminFetch<{ duplicate: boolean; obNumber: string | null }>("/admin/ob/messages/check", {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (check.duplicate) {
        setError(check.obNumber ? `That message is already on ${check.obNumber}.` : "That message is already on an occurrence book entry.");
        return;
      }
      setDrafts((current) => [...current, { key: crypto.randomUUID(), body, groupId: pasteGroupId }]);
      setPasteBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check that message");
    }
  }

  async function fillFromMessages() {
    const stored = detail.data?.messages ?? [];
    const groups = meta.data?.pasteGroups ?? [];
    const passageMessages = [
      ...stored.map((message) => ({ groupName: message.groupName, body: message.body })),
      ...drafts.map((draft) => ({ groupName: groups.find((group) => group.id === draft.groupId)?.name ?? "", body: draft.body })),
    ];
    if (!passageMessages.length) return;
    setFilling(true);
    setError("");
    setTrainingSaved(null);
    try {
      const directory = [
        ...(meta.data?.residents ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          kind: "resident" as const,
        })),
        ...(meta.data?.members ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          callSign: row.callSign,
          kind: "member" as const,
        })),
      ];
      const examples = (meta.data?.needleExamples ?? [])
        .filter((row) => row.vote === "up")
        .slice(0, 8)
        .map((row) => ({
          passage: row.passage,
          corrected: (row.correctedFill ?? row.needleFill) as Partial<NeedleFill>,
        }));
      const fill = await extractIncident(passageMessages, meta.data?.suburbs ?? [], { directory, examples });
      const firstGroup = groups.find((group) => group.id === (stored[0]?.groupId || drafts[0]?.groupId));
      const groupIds = [...stored.map((message) => message.groupId), ...drafts.map((draft) => draft.groupId)];
      const received = [...new Set(groupIds.map((id) => groups.find((group) => group.id === id)?.receivedFrom).filter((value): value is "CPF Group" | "Other Groups" => !!value))];
      const applied = applyFill(form, fill, mode === "new" && !filled, firstGroup?.sectorId ?? "", received, autoDescription);
      setForm(applied.form);
      setAutoDescription(applied.autoDescription);
      setFilled(true);
      setLastNeedle({ passage: joinMessages(passageMessages), messages: passageMessages, fill });
      setOpenSection("incident");
      if (fill.warning) setError(fill.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fill the entry");
    } finally {
      setFilling(false);
    }
  }

  async function rateNeedle(vote: "up" | "down") {
    if (!lastNeedle) return;
    setTrainingBusy(true);
    setError("");
    try {
      await adminFetch("/admin/ob/needle-examples", {
        method: "POST",
        body: JSON.stringify({
          passage: lastNeedle.passage,
          messages: lastNeedle.messages,
          needle_fill: lastNeedle.fill,
          corrected_fill: formAsCorrectedFill(form),
          vote,
          notes: trainingNote.trim(),
          source: "live",
        }),
      });
      setTrainingSaved(vote);
      setTrainingNote("");
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the training vote");
    } finally {
      setTrainingBusy(false);
    }
  }

  async function removeStoredMessage(id: string) {
    if (!editingId) return;
    setError("");
    try {
      await adminFetch(`/admin/ob/entries/${editingId}/messages/${id}`, { method: "DELETE" });
      setHydrated(null);
      await qc.invalidateQueries({ queryKey: ["admin.ob.entry", editingId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the message");
    }
  }

  async function logShift() {
    if (!shiftMemberId || !shiftFrom || !shiftTo) {
      setError("Choose who is coming on, and the hours.");
      setShiftOpen(true);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await adminFetch("/admin/ob/commence-shift", {
        method: "POST",
        body: JSON.stringify({
          sector_id: shiftSector || profile?.sector_id || undefined,
          patroller_id: shiftMemberId,
          date: shiftDate,
          from: shiftFrom,
          to: shiftTo,
        }),
      });
      setShiftOpen(false);
      setShiftFrom("");
      setShiftTo("");
      void qc.invalidateQueries({ queryKey: ["admin.ob.entries"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log the shift");
    } finally {
      setSaving(false);
    }
  }

  async function standDown(entryId?: string) {
    setError("");
    setSaving(true);
    try {
      await adminFetch("/admin/ob/stand-down", {
        method: "POST",
        body: JSON.stringify({ sector_id: profile?.sector_id, entry_id: entryId }),
      });
      setMode("list");
      setEditingId(null);
      setHydrated(null);
      void qc.invalidateQueries({ queryKey: ["admin.ob.entries"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not stand down");
    } finally {
      setSaving(false);
    }
  }

  async function addTag() {
    const label = newTag.trim();
    if (label.length < 2) return;
    setError("");
    try {
      const row = await adminFetch<{ key: string; label: string }>("/admin/ob/tags", { method: "POST", body: JSON.stringify({ label }) });
      setNewTag("");
      setForm((current) => ({
        ...current,
        tagKeys: current.tagKeys.includes(row.key) ? current.tagKeys : [...current.tagKeys, row.key],
      }));
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the tag");
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
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f3f3]">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 bg-white px-3 py-3 sm:gap-3 sm:px-6">
          <button type="button" className="text-sm font-medium text-gray-600 hover:text-gray-900" onClick={backToList}>
            ← Book
          </button>
          <h1 className="text-base font-bold text-gray-900 sm:text-lg">{heading}</h1>
          {detail.data && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${detail.data.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`}>
              {detail.data.status === "active" ? "Active" : "Closed"}
            </span>
          )}
          {!isShiftRow && (
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Btn variant="ghost" onClick={backToList}>Cancel</Btn>
              <Btn onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : mode === "new" ? "Save incident" : "Save changes"}</Btn>
              {mode === "edit" && form.conclusion && (
                <Btn variant="danger" onClick={() => void closeEntry()} disabled={saving}>Close</Btn>
              )}
            </div>
          )}
        </div>
        {error && <p className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 sm:px-6">{error}</p>}
        {mode === "edit" && detail.isLoading && <p className="px-4 py-4 text-sm text-gray-500">Loading…</p>}

        {isShiftRow ? (
          <div className="overflow-auto px-4 py-6 sm:px-8">
            <div className="mx-auto max-w-2xl rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <p className="mb-4 text-sm text-gray-600">
              {isCommence
                ? `Commence Shift for ${detail.data?.callSign}. It closes on its own at the end of the hours, or when the next person comes on.`
                : `Stand Down for ${detail.data?.callSign}.`} This is a book row, not a patrol.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" required><input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Time" required><input className={inputCls} type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="mt-4 flex justify-end gap-2">
              {isCommence && detail.data?.status === "active" && (
                <Btn variant="danger" onClick={() => void standDown(detail.data?.id)} disabled={saving}>Stand Down</Btn>
              )}
              <Btn onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
            </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-black/10 bg-[#f7f7f7] px-2 py-2 md:hidden" aria-label="Incident sections">
              {formTabs.map((item) => {
                const selected = openSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={selected ? "page" : undefined}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${selected ? "bg-gray-900 font-semibold text-white" : item.secondary ? "text-gray-500 ring-1 ring-gray-200" : "text-gray-800 ring-1 ring-black/10"}`}
                    onClick={() => setOpenSection(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <aside className="hidden h-full w-56 shrink-0 flex-col border-r border-black/10 bg-[#f7f7f7] sm:w-64 md:flex">
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="Incident sections">
                {formTabs.map((item) => {
                  const selected = openSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      className={`relative flex w-full items-center rounded-md px-3 py-2.5 text-left text-sm ${selected ? "bg-black/10 font-semibold text-gray-900" : item.secondary ? "text-gray-500 hover:bg-black/5" : "text-gray-800 hover:bg-black/5"}`}
                      onClick={() => setOpenSection(item.id)}
                    >
                      {selected && <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-[#0067c0]" aria-hidden />}
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
              <div className="flex w-full flex-1 flex-col px-4 py-5 sm:px-8 sm:py-8">
            {openSection === "ai" && (
            <FormPane
              label="AI assist"
              blurb="Optional while the training set is built in Settings → AI Training. Manual logging is the main path."
            >
            <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm sm:p-5">
              <Field label="Add these messages to">
                <select className={selectCls} value={mode === "edit" ? editingId ?? "" : ""} onChange={(e) => chooseEntry(e.target.value)}>
                  <option value="">New incident</option>
                  {(activeEntries.data?.results ?? []).filter((row) => row.status === "active").map((row) => (
                    <option key={row.id} value={row.id}>{row.obNumber} · {row.primaryType || "Incident"}{row.messageCount ? ` · ${row.messageCount} messages` : ""}</option>
                  ))}
                </select>
              </Field>
              {entryOpen && (
                <>
                  <Field label="Group">
                    <select className={selectCls} value={pasteGroupId} onChange={(e) => setPasteGroupId(e.target.value)}>
                      <option value="">{pasteGroups.length ? "Choose a group" : "No groups yet"}</option>
                      {pasteGroups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.receivedFrom}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      <Link to="/settings" className="font-medium text-gray-700 underline">Add groups in Settings</Link>
                    </p>
                  </Field>
                  <textarea className={inputCls} rows={4} placeholder="Paste one message" value={pasteBody} onChange={(e) => setPasteBody(e.target.value)} />
                  <div className="mt-2"><Btn variant="ghost" onClick={() => void addDraft()}>Add</Btn></div>
                </>
              )}
              <ul className="mt-4 space-y-2 text-sm">
                {storedMessages.map((message) => (
                  <li key={message.id} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                      <span>{message.groupName || "Message"}</span>
                      {entryOpen && <button type="button" className="text-red-700" onClick={() => void removeStoredMessage(message.id)}>Remove</button>}
                    </div>
                    <p className="whitespace-pre-wrap text-gray-800">{message.body}</p>
                  </li>
                ))}
                {drafts.map((draft) => (
                  <li key={draft.key} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                      <span>{pasteGroups.find((group) => group.id === draft.groupId)?.name ?? "Message"}</span>
                      <button type="button" className="text-red-700" onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}>Remove</button>
                    </div>
                    <p className="whitespace-pre-wrap text-gray-800">{draft.body}</p>
                  </li>
                ))}
                {storedMessages.length + drafts.length === 0 && <li className="text-gray-500">No messages yet.</li>}
              </ul>
              {entryOpen && (
                <div className="mt-4 flex justify-end gap-2">
                  <Btn onClick={() => void fillFromMessages()} disabled={filling || storedMessages.length + drafts.length === 0}>
                    {filling ? "Reading messages…" : "Fill from AI"}
                  </Btn>
                </div>
              )}
              {lastNeedle && entryOpen && (
                <div className="mt-4 rounded-lg border border-black/10 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">AI fill — rate this for training</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Thumbs up keeps the corrected fields as a good example. Thumbs down stores what you fixed so the next fill can learn from it.
                        {" "}
                        <Link to="/settings/ai-training" className="font-medium text-gray-700 underline">Manage AI Training in Settings</Link>
                      </p>
                      <ul className="mt-2 space-y-0.5 text-xs text-gray-700">
                        <li>Type: {lastNeedle.fill.incidentKey ? (obType(lastNeedle.fill.incidentKey)?.name ?? lastNeedle.fill.incidentKey) : "—"}</li>
                        <li>Place: {[lastNeedle.fill.street, meta.data?.suburbs.find((s) => s.id === lastNeedle.fill.suburbId)?.name].filter(Boolean).join(", ") || "—"}</li>
                        <li>Time: {[lastNeedle.fill.date, lastNeedle.fill.time].filter(Boolean).join(" ") || "—"}</li>
                        <li>
                          Vehicle: {lastNeedle.fill.vehicle
                            ? [lastNeedle.fill.vehicle.colour, lastNeedle.fill.vehicle.make, lastNeedle.fill.vehicle.model, lastNeedle.fill.vehicle.shape].filter(Boolean).join(" ")
                            : "—"}
                        </li>
                        <li>
                          People: {lastNeedle.fill.persons.length
                            ? lastNeedle.fill.persons.map((p) => [p.ethnicity, p.gender, p.name, p.clothing].filter(Boolean).join(" ")).join(" · ")
                            : "—"}
                        </li>
                        <li>Contact: {[lastNeedle.fill.contactName, lastNeedle.fill.contactPhone].filter(Boolean).join(" ") || "—"}</li>
                        {lastNeedle.fill.directoryHits.length > 0 && (
                          <li>
                            Directory: {lastNeedle.fill.directoryHits.map((h) => `${h.kind} ${h.name}`).join("; ")}
                          </li>
                        )}
                      </ul>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={trainingBusy || trainingSaved !== null}
                        onClick={() => void rateNeedle("up")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-green-50 disabled:opacity-40"
                        title="Good fill"
                        aria-label="Thumbs up"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M7 11v9H4v-9h3zm3 9h7.2a2 2 0 0 0 1.95-1.55l1.3-5.2A1.8 1.8 0 0 0 18.7 11H14V7.2A2.2 2.2 0 0 0 11.8 5L10 11v9z" />
                        </svg>
                        Good
                      </button>
                      <button
                        type="button"
                        disabled={trainingBusy || trainingSaved !== null}
                        onClick={() => void rateNeedle("down")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-red-50 disabled:opacity-40"
                        title="Needs correction"
                        aria-label="Thumbs down"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M17 13V4h3v9h-3zm-3-9H6.8a2 2 0 0 0-1.95 1.55l-1.3 5.2A1.8 1.8 0 0 0 5.3 13H10v3.8A2.2 2.2 0 0 0 12.2 19L14 13V4z" />
                        </svg>
                        Fix needed
                      </button>
                    </div>
                  </div>
                  {trainingSaved && (
                    <p className="mt-2 text-xs text-green-800">
                      Saved as {trainingSaved === "up" ? "a good example" : "a correction"} for future fills.
                    </p>
                  )}
                  {!trainingSaved && (
                    <input
                      className={`${inputCls} mt-3`}
                      placeholder="Optional note (what should have been filled)"
                      value={trainingNote}
                      onChange={(e) => setTrainingNote(e.target.value)}
                    />
                  )}
                </div>
              )}
            </section>
            </FormPane>
            )}
            {showForm && openSection !== "ai" && <>
            <AccordionSection title="Incident" open={openSection === "incident"} onToggle={() => toggleSection("incident")}>
              {(meta.data?.sectors.length ?? 0) > 1 && (
                <Field label="Sector" required>
                  <select className={selectCls} value={form.sectorId} disabled={mode === "edit" || drafts.length > 0 || storedMessages.length > 0} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
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
            </AccordionSection>

            <AccordionSection title="Location" open={openSection === "location"} onToggle={() => toggleSection("location")}>
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
            </AccordionSection>

            <AccordionSection title="Description" open={openSection === "description"} onToggle={() => toggleSection("description")}>
              <textarea className={inputCls} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </AccordionSection>

            {showVehicle && <AccordionSection title="Vehicle of interest" open={openSection === "vehicle"} onToggle={() => toggleSection("vehicle")}>
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
                  <input className={inputCls} placeholder="Name, if known" value={v.name} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, name: e.target.value } : row) })} />
                  <select className={selectCls} value={v.identifier} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, identifier: e.target.value } : row) })}>
                    <option value="">Code name</option>
                    {OB_PHONETIC_CODES.map((code) => <option key={code}>{code}</option>)}
                  </select>
                  <input className={inputCls} placeholder="Distinguishing features" value={v.features} onChange={(e) => setForm({ ...form, vehicles: form.vehicles.map((row, j) => j === i ? { ...row, features: e.target.value } : row) })} />
                </div>
              ))}
              <Btn variant="ghost" onClick={() => setForm({ ...form, vehicles: [...form.vehicles, emptyVehicle()] })}>+ Another vehicle</Btn>
            </AccordionSection>}

            {showPerson && <AccordionSection title="Person of interest" open={openSection === "person"} onToggle={() => toggleSection("person")}>
              {form.pois.map((p, i) => (
                <div key={i} className="mb-3 grid gap-2 sm:grid-cols-2">
                  <input className={inputCls} placeholder="Name, if known" value={p.name} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, name: e.target.value } : row) })} />
                  <select className={selectCls} value={p.identifier} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, identifier: e.target.value } : row) })}>
                    <option value="">Code name</option>
                    {OB_PHONETIC_CODES.map((code) => <option key={code}>{code}</option>)}
                  </select>
                  <select className={selectCls} value={p.ethnicity} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, ethnicity: e.target.value } : row) })}>
                    <option value="">Ethnicity, if known</option>
                    {OB_ETHNICITIES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <select className={selectCls} value={p.gender} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, gender: e.target.value } : row) })}>
                    <option value="">Gender</option>
                    {OB_POI_GENDERS.map((g) => <option key={g}>{g}</option>)}
                  </select>
                  <input className={inputCls} placeholder="Clothing" value={p.clothing} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, clothing: e.target.value } : row) })} />
                  <input className={inputCls} placeholder="Direction of travel" value={p.direction} onChange={(e) => setForm({ ...form, pois: form.pois.map((row, j) => j === i ? { ...row, direction: e.target.value } : row) })} />
                </div>
              ))}
              <Btn variant="ghost" onClick={() => setForm({ ...form, pois: [...form.pois, emptyPoi()] })}>+ Person</Btn>
            </AccordionSection>}

            {showInjured && <AccordionSection title="Injured people" open={openSection === "injured"} onToggle={() => toggleSection("injured")}>
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
            </AccordionSection>}

            <AccordionSection title="Tags" open={openSection === "tags"} onToggle={() => toggleSection("tags")}>
              <Field label="Tags">
                <MultiSelect
                  searchable
                  placeholder="Choose tags"
                  options={(meta.data?.tags ?? OB_TAGS).map((t) => ({ value: t.key, label: t.label }))}
                  value={form.tagKeys}
                  onChange={(tagKeys) => setForm({ ...form, tagKeys })}
                />
              </Field>
              <div className="flex gap-2">
                <input className={inputCls} placeholder="Add a tag if it is missing" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
                <Btn variant="ghost" onClick={() => void addTag()}>Add</Btn>
              </div>
            </AccordionSection>

            <AccordionSection title="Who reacted" open={openSection === "reacted"} onToggle={() => toggleSection("reacted")}>
              <Field label="Patrols that responded">
                <MultiSelect
                  placeholder="Choose patrols"
                  emptyText="No active patrols in this sector right now."
                  options={patrolOptions}
                  value={form.patrolIds}
                  onChange={(patrolIds) => setForm({ ...form, patrolIds })}
                />
              </Field>
              <Field label="CPF members">
                <MultiSelect
                  placeholder="Choose members"
                  emptyText="No active members in this sector."
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
            </AccordionSection>

            {mode === "edit" && detail.data && (
              <AccordionSection title="Last seen" open={openSection === "seen"} onToggle={() => toggleSection("seen")}>
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
              </AccordionSection>
            )}

            <AccordionSection title="Close" open={openSection === "close"} onToggle={() => toggleSection("close")}>
              <Field label="Conclusion">
                <select className={selectCls} value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })}>
                  <option value="">Leave active</option>
                  {OB_CONCLUSIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <p className="text-xs text-gray-500">Photos are not on this form yet. They will be stored on the incident once file upload is in place.</p>
            </AccordionSection>
            </>}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-auto bg-[#f3f3f3]">
      <div className="px-4 py-5 sm:px-8 sm:py-8">
      <PageHeader
        title="OB Book"
        search={search}
        onSearch={setSearch}
        action={
          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" onClick={() => setShiftOpen((open) => !open)}>{shiftOpen ? "Hide shift change" : "Shift change"}</Btn>
            <Btn variant="ghost" onClick={() => void standDown()}>Stand Down</Btn>
            <Btn onClick={startNew}>+ Log incident</Btn>
          </div>
        }
      />
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {shiftOpen && (
        <div className="mb-4 rounded-xl border bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Call centre shift change</h2>
          <p className="mb-3 text-xs text-gray-500">The person already on shift is stood down. This shift closes itself at the end time.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(meta.data?.sectors.length ?? 0) > 1 && (
              <select className={selectCls} value={shiftSector || profile?.sector_id || ""} onChange={(e) => { setShiftSector(e.target.value); setShiftMemberId(""); }}>
                {meta.data?.sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}{sector.code ? ` (${sector.code})` : ""}</option>)}
              </select>
            )}
            <select className={selectCls} value={shiftMemberId} onChange={(e) => setShiftMemberId(e.target.value)}>
              <option value="">Who is coming on</option>
              {(meta.data?.members ?? [])
                .filter((member) => {
                  const sectorId = shiftSector || profile?.sector_id || "";
                  return !sectorId || member.sectorId === sectorId;
                })
                .slice()
                .sort((a, b) => a.callSign.localeCompare(b.callSign))
                .map((member) => <option key={member.id} value={member.id}>{member.callSign} {member.name}</option>)}
            </select>
            <input className={inputCls} type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} type="time" value={shiftFrom} onChange={(e) => setShiftFrom(e.target.value)} />
              <input className={inputCls} type="time" value={shiftTo} onChange={(e) => setShiftTo(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Btn onClick={() => void logShift()} disabled={saving}>{saving ? "Saving…" : "Log shift change"}</Btn>
          </div>
        </div>
      )}
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
            {
              header: "OB",
              render: (r) => (
                <span className="font-medium">
                  {r.obNumber}
                  {r.messageCount > 0 && <><br /><span className="text-xs font-normal text-gray-500">{r.messageCount} {r.messageCount === 1 ? "message" : "messages"}</span></>}
                </span>
              ),
            },
            { header: "When", render: (r) => <span>{r.occurredAt.slice(0, 16)}<br /><span className="text-xs text-gray-500">{r.dayOfWeek} · {r.timeOfDay}</span></span> },
            { header: "Where", render: (r) => <span>{r.suburbName ?? "—"}{r.street ? ` · ${r.street}` : ""}</span> },
            { header: "Type", render: (r) => <span>{r.primaryType}{r.primaryCode ? ` (${codeWithPhase(r.primaryCode, r.phase)})` : ""}{r.typeCount > 1 ? ` +${r.typeCount - 1}` : ""}{r.primaryType === "Commence Shift" && r.description ? <><br /><span className="whitespace-pre-line text-xs font-normal text-gray-600">{r.description}</span></> : null}</span> },
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
              render: (r) => <RowActions onEdit={() => { setEditingId(r.id); setHydrated(null); setOpenSection("incident"); setMode("edit"); }} />,
            },
          ]}
        />
      )}
      </div>
    </div>
  );
}
