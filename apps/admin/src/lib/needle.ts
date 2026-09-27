import {
  OB_POI_GENDERS,
  OB_VOI_COLOURS,
  OB_VOI_SHAPES,
  attendanceInText,
  clockInText,
  dateInText,
  matchIncidentPhrase,
  matchSuburbName,
  obType,
  personsInText,
  phonesInText,
} from "@patrol-log/shared";
import { getApiBaseUrl, authStore } from "./api";

export interface PassageMessage {
  groupName: string;
  body: string;
}

export interface DirectoryPerson {
  id: string;
  name: string;
  phone: string | null;
  callSign?: string | null;
  kind: "resident" | "member";
}

export interface NeedleExample {
  passage: string;
  corrected: Partial<NeedleFill>;
}

export interface NeedleFill {
  warning: string;
  incidentKey: string | null;
  tagKeys: string[];
  phase: "" | "alpha" | "bravo";
  suburbId: string | null;
  street: string;
  description: string;
  date: string;
  time: string;
  attendance: "" | "present" | "assisting";
  vehicle: { colour: string; make: string; model: string; registration: string; shape: string } | null;
  person: { gender: string; clothing: string; direction: string; name: string; ethnicity: string } | null;
  persons: { gender: string; clothing: string; direction: string; name: string; ethnicity: string }[];
  contactName: string;
  contactPhone: string;
  directoryHits: { kind: "resident" | "member"; name: string; phone: string; callSign?: string }[];
  raw: Record<string, unknown> | null;
}

const TOOLS = JSON.stringify([
  {
    name: "extract_incident",
    description: "Read a patrol WhatsApp report and return the incident fields.",
    parameters: {
      type: "object",
      properties: {
        incident_phrase: { type: "string", description: "Kind of incident in a few words, for example house breaking" },
        place: { type: "string", description: "Street, complex and suburb copied from the report" },
        phase: { type: "string", description: "alpha if still happening, bravo if already over" },
        vehicle: { type: "string", description: "Vehicle colour, make, model, shape and registration" },
        person: { type: "string", description: "All people of interest with clothing" },
        contact: { type: "string", description: "Complainant or contact name and phone" },
      },
      required: ["incident_phrase"],
    },
  },
]);

let loading: Promise<import("needle-rs").NeedleV3Wasm> | null = null;

function weightsUrl(): { url: string; headers: HeadersInit } {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return { url: "/needle3.cact", headers: {} };
  const headers: HeadersInit = {};
  const token = authStore.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: `${getApiBaseUrl()}/admin/ob/needle`, headers };
}

async function loadEngine() {
  if (!loading) {
    loading = (async () => {
      const needle = await import("needle-rs");
      await needle.default();
      const { url, headers } = weightsUrl();
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error("Needle weights could not be loaded.");
      const bytes = new Uint8Array(await res.arrayBuffer());
      const engine = needle.NeedleV3Wasm.load(bytes);
      if (!engine) throw new Error("Needle 3 could not start.");
      return engine;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function grounded(value: string, passage: string): boolean {
  const folded = compact(value);
  return folded.length >= 2 && compact(passage).includes(folded);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(payload: string): Record<string, unknown> | null {
  if (!payload || payload === "[]") return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    const call = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!call || typeof call !== "object") return null;
    const raw = (call as { arguments?: unknown }).arguments;
    if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
    if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function phraseMatch(phrase: string): { key: string | null; tagKeys: string[] } {
  const hit = matchIncidentPhrase(phrase);
  return { key: hit?.key ?? null, tagKeys: hit?.tagKeys ?? [] };
}

function colourOf(value: string): string {
  const folded = value.toLowerCase();
  return OB_VOI_COLOURS.find((colour) => folded.includes(colour.toLowerCase())) ?? "";
}

function shapeOf(value: string): string {
  const folded = value.toLowerCase();
  if (/\b(hatch(?:back)?|tsi)\b/.test(folded)) return "Hatchback";
  if (/\b(suv|4\s*x\s*4|4x4)\b/.test(folded)) return "SUV / 4x4";
  if (/\b(bakkie|truck|ute)\b/.test(folded)) return "Bakkie / Truck";
  if (/\b(van|minibus|kombi)\b/.test(folded)) return "Van / Minibus";
  if (/\b(motor\s*cycle|bike|scooter)\b/.test(folded)) return "Motorcycle";
  if (/\bbus\b/.test(folded)) return "Bus";
  if (/\bsedan\b/.test(folded)) return "Sedan";
  return OB_VOI_SHAPES.find((shape) => folded.includes(shape.toLowerCase())) ?? "";
}

function genderOf(value: string): string {
  const folded = value.toLowerCase();
  return OB_POI_GENDERS.find((gender) => folded.includes(gender.toLowerCase())) ?? "";
}

function phaseOf(value: string): "" | "alpha" | "bravo" {
  const folded = value.toLowerCase();
  if (folded.includes("alpha") || folded.includes("still")) return "alpha";
  if (folded.includes("bravo") || folded.includes("over") || folded.includes("already") || folded.includes("fled") || folded.includes("drove")) return "bravo";
  return "";
}

function phaseInText(text: string): "" | "alpha" | "bravo" {
  const folded = text.toLowerCase();
  if (/\b(in progress|still happening|happening now)\b/.test(folded)) return "alpha";
  if (/\b(already over|all over|suspects fled|suspects gone|drove towards|drove away|stole)\b/.test(folded)) return "bravo";
  return "";
}

function sastToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function splitPlace(
  place: string,
  suburbs: { id: string; name: string; aliases: string[] }[],
): { suburbId: string | null; street: string } {
  const suburbId = matchSuburbName(place, suburbs);
  const suburb = suburbs.find((item) => item.id === suburbId);
  let street = place.trim();
  if (suburb) {
    for (const label of [suburb.name, ...suburb.aliases]) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      street = street.replace(new RegExp(`^\\s*${escaped}\\s*[,\\-–]?\\s*|\\s*[,\\-–]?\\s*${escaped}\\s*$`, "ig"), " ");
      street = street.replace(new RegExp(escaped, "ig"), " ");
    }
  }
  street = street.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
  return { suburbId, street };
}

function streetFromPassage(passage: string, suburbs: { id: string; name: string; aliases: string[] }[]): { suburbId: string | null; street: string } {
  const suburbId = matchSuburbName(passage, suburbs);
  const lines = passage.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const streetLine = lines.find((line) =>
    /\b(no\.?\s*\d+|avenue|ave|street|str|road|rd|drive|dr|close|crescent|complex|garden|estate|unit)\b/i.test(line)
    && !matchSuburbName(line, suburbs),
  ) ?? "";
  return { suburbId, street: streetLine.replace(/\s+/g, " ").trim() };
}

function vehicleFrom(value: string, passage: string): NeedleFill["vehicle"] {
  const raw = value || passage;
  if (!raw) return null;
  const colour = colourOf(raw);
  const shape = shapeOf(raw);
  let rest = raw;
  if (colour) rest = rest.replace(new RegExp(colour, "i"), " ");
  if (shape) rest = rest.replace(new RegExp(shape.replace(/[\\/]/g, "|"), "i"), " ");
  rest = rest
    .replace(/\b(hatch(?:back)?|tsi|shape|sedan|suv|4x4|bakkie|truck|van|minibus|motorcycle|bus)\b/gi, " ")
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!colour && !shape && !rest) return null;
  if (value && !grounded(value, passage) && !colour && !shape) return null;
  const parts = rest.split(/\s+/).filter(Boolean);
  const make = parts[0] ?? "";
  const model = parts.slice(1).join(" ");
  const resolvedShape = shape || (/\bgolf\b/i.test(make) ? "Hatchback" : "");
  return { colour, make, model, registration: "", shape: resolvedShape };
}

function contactFrom(value: string, passage: string): { name: string; phone: string } {
  const source = value && grounded(value, passage) ? value : passage;
  const phones = phonesInText(source);
  const phone = phones[0] ?? "";
  const nameMatch = source.match(/(?:contact|complainant|caller)\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{1,40})/i);
  const name = (nameMatch?.[1] ?? "").trim();
  return { name, phone };
}

function directoryHits(passage: string, directory: DirectoryPerson[]): NeedleFill["directoryHits"] {
  const phones = new Set(phonesInText(passage));
  const hay = compact(passage);
  const hits: NeedleFill["directoryHits"] = [];
  for (const row of directory) {
    const phone = (row.phone ?? "").replace(/\D/g, "").replace(/^27/, "0");
    const nameHit = row.name.trim().length >= 3 && hay.includes(compact(row.name));
    const callHit = row.callSign && hay.includes(compact(row.callSign));
    const phoneHit = phone.length >= 9 && phones.has(phone);
    if (!nameHit && !callHit && !phoneHit) continue;
    hits.push({ kind: row.kind, name: row.name, phone: row.phone ?? phone, callSign: row.callSign ?? undefined });
  }
  return hits;
}

function fewShotBlock(examples: NeedleExample[]): string {
  if (!examples.length) return "";
  return examples
    .slice(0, 3)
    .map((example, index) => {
      const fill = example.corrected;
      const lines = [
        `Example ${index + 1} report:`,
        example.passage.slice(0, 600),
        `Example ${index + 1} answer: incident=${fill.incidentKey ?? ""}; place=${[fill.street, fill.suburbId].filter(Boolean).join(" ")}; vehicle=${fill.vehicle ? [fill.vehicle.colour, fill.vehicle.make, fill.vehicle.model, fill.vehicle.shape].filter(Boolean).join(" ") : ""}; people=${(fill.persons ?? []).map((p) => [p.ethnicity, p.gender, p.name, p.clothing].filter(Boolean).join(" ")).join(" | ")}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

export function joinMessages(messages: PassageMessage[]): string {
  return messages
    .map((message) => {
      const body = message.body.trim();
      return message.groupName ? `${message.groupName}: ${body}` : body;
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function extractIncident(
  messages: PassageMessage[],
  suburbs: { id: string; name: string; aliases: string[] }[],
  options?: { directory?: DirectoryPerson[]; examples?: NeedleExample[] },
): Promise<NeedleFill> {
  const description = joinMessages(messages);
  const passage = messages.map((message) => message.body).join("\n");
  const today = sastToday();
  const scannedPeople = personsInText(passage);
  const hits = directoryHits(passage, options?.directory ?? []);
  const contactFallback = contactFrom("", passage);
  if (!contactFallback.name && hits[0]) contactFallback.name = hits[0].name;
  if (!contactFallback.phone && hits[0]?.phone) contactFallback.phone = hits[0].phone.replace(/\D/g, "").replace(/^27/, "0");

  const empty: NeedleFill = {
    warning: "",
    incidentKey: null,
    tagKeys: [],
    phase: "",
    suburbId: matchSuburbName(passage, suburbs),
    street: streetFromPassage(passage, suburbs).street,
    description,
    date: dateInText(passage, today) ?? "",
    time: clockInText(passage) ?? "",
    attendance: attendanceInText(passage) ?? "",
    vehicle: vehicleFrom("", passage),
    person: scannedPeople[0] ?? null,
    persons: scannedPeople,
    contactName: contactFallback.name,
    contactPhone: contactFallback.phone,
    directoryHits: hits,
    raw: null,
  };
  const scanned = phraseMatch(passage);
  empty.incidentKey = scanned.key;
  empty.tagKeys = scanned.tagKeys;
  if (!empty.vehicle?.colour && !empty.vehicle?.make) empty.vehicle = vehicleFrom(passage, passage);

  let args: Record<string, unknown> | null = null;
  try {
    const needle = await import("needle-rs");
    const engine = await loadEngine();
    const prompt = [
      fewShotBlock(options?.examples ?? []),
      hits.length
        ? `Directory matches already found in this CPF:\n${hits.map((h) => `- ${h.kind} ${h.name}${h.callSign ? ` (${h.callSign})` : ""}${h.phone ? ` ${h.phone}` : ""}`).join("\n")}`
        : "",
      "Report to extract:",
      passage,
    ].filter(Boolean).join("\n\n");
    const completion = engine.run(prompt, TOOLS);
    args = parseArgs(needle.extract_tool_call_v3(completion) || "[]");
  } catch (err) {
    return { ...empty, warning: err instanceof Error ? err.message : "Needle could not read the messages." };
  }

  const phrase = textOf(args?.incident_phrase);
  const fromPhrase = phrase && grounded(phrase, passage) ? phraseMatch(phrase) : { key: null, tagKeys: [] as string[] };
  const incidentKey = fromPhrase.key ?? empty.incidentKey;
  const tagKeys = [...new Set([...(fromPhrase.key ? fromPhrase.tagKeys : []), ...empty.tagKeys])];
  const type = incidentKey ? obType(incidentKey) : undefined;
  const place = textOf(args?.place);
  const located = place && grounded(place, passage) ? splitPlace(place, suburbs) : streetFromPassage(passage, suburbs);
  const phase = phaseOf(textOf(args?.phase)) || phaseInText(passage);
  const vehicle = vehicleFrom(textOf(args?.vehicle), passage) ?? empty.vehicle;
  const needlePeople = personsInText(textOf(args?.person) || passage);
  const persons = needlePeople.length ? needlePeople : empty.persons;
  const contact = contactFrom(textOf(args?.contact), passage);
  if (!contact.name) contact.name = empty.contactName;
  if (!contact.phone) contact.phone = empty.contactPhone;

  return {
    warning: type ? "" : "Needle could not tell the incident type. Check the fields before you save.",
    incidentKey: type ? incidentKey : null,
    tagKeys: type ? tagKeys : [],
    phase: type?.category === "criminal" ? phase : "",
    suburbId: located.suburbId ?? empty.suburbId,
    street: located.street || empty.street,
    description,
    date: empty.date,
    time: empty.time,
    attendance: empty.attendance,
    vehicle,
    person: persons[0] ?? null,
    persons,
    contactName: contact.name,
    contactPhone: contact.phone,
    directoryHits: hits,
    raw: args,
  };
}
