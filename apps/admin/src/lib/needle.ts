import {
  OB_POI_GENDERS,
  OB_VOI_COLOURS,
  attendanceInText,
  clockInText,
  dateInText,
  matchIncidentPhrase,
  matchSuburbName,
  obType,
} from "@patrol-log/shared";
import { getApiBaseUrl, authStore } from "./api";

export interface PassageMessage {
  groupName: string;
  body: string;
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
  vehicle: { colour: string; make: string; model: string; registration: string } | null;
  person: { gender: string; clothing: string; direction: string } | null;
}

const TOOLS = JSON.stringify([
  {
    name: "extract_incident",
    description: "Read a patrol report and return the incident fields.",
    parameters: {
      type: "object",
      properties: {
        incident_phrase: { type: "string", description: "Kind of incident in a few words, for example armed robbery" },
        place: { type: "string", description: "Street and suburb, copied from the report" },
        phase: { type: "string", description: "alpha if still happening, bravo if already over" },
        vehicle: { type: "string", description: "Vehicle colour, make and registration, if stated" },
        person: { type: "string", description: "Person description, if stated" },
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

function genderOf(value: string): string {
  const folded = value.toLowerCase();
  return OB_POI_GENDERS.find((gender) => folded.includes(gender.toLowerCase())) ?? "";
}

function phaseOf(value: string): "" | "alpha" | "bravo" {
  const folded = value.toLowerCase();
  if (folded.includes("alpha") || folded.includes("still")) return "alpha";
  if (folded.includes("bravo") || folded.includes("over") || folded.includes("already")) return "bravo";
  return "";
}

function phaseInText(text: string): "" | "alpha" | "bravo" {
  const folded = text.toLowerCase();
  if (/\b(in progress|still happening|happening now)\b/.test(folded)) return "alpha";
  if (/\b(already over|all over|suspects fled|suspects gone)\b/.test(folded)) return "bravo";
  return "";
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
      street = street.replace(new RegExp(escaped, "ig"), " ");
    }
  }
  street = street.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
  return { suburbId, street };
}

function vehicleFrom(value: string, passage: string): NeedleFill["vehicle"] {
  if (!value || !grounded(value, passage)) return null;
  const colour = colourOf(value);
  const make = (colour ? value.replace(new RegExp(colour, "i"), "") : value).replace(/\s+/g, " ").trim();
  return { colour, make, model: "", registration: "" };
}

function personFrom(value: string, passage: string): NeedleFill["person"] {
  if (!value || !grounded(value, passage)) return null;
  const gender = genderOf(value);
  const clothing = (gender ? value.replace(new RegExp(gender, "i"), "") : value).replace(/\s+/g, " ").trim();
  return { gender, clothing, direction: "" };
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
): Promise<NeedleFill> {
  const description = joinMessages(messages);
  const passage = messages.map((message) => message.body).join("\n");
  const empty: NeedleFill = {
    warning: "",
    incidentKey: null,
    tagKeys: [],
    phase: "",
    suburbId: matchSuburbName(passage, suburbs),
    street: "",
    description,
    date: dateInText(passage) ?? "",
    time: clockInText(passage) ?? "",
    attendance: attendanceInText(passage) ?? "",
    vehicle: null,
    person: null,
  };
  const scanned = phraseMatch(passage);
  empty.incidentKey = scanned.key;
  empty.tagKeys = scanned.tagKeys;

  let args: Record<string, unknown> | null = null;
  try {
    const needle = await import("needle-rs");
    const engine = await loadEngine();
    const completion = engine.run(passage, TOOLS);
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
  const located = place && grounded(place, passage) ? splitPlace(place, suburbs) : { suburbId: null, street: "" };
  const phase = phaseOf(textOf(args?.phase)) || phaseInText(passage);

  return {
    warning: type ? "" : "Needle could not tell the incident type. Check the fields before you save.",
    incidentKey: type ? incidentKey : null,
    tagKeys: type ? tagKeys : [],
    phase: type?.category === "criminal" ? phase : "",
    suburbId: located.suburbId ?? empty.suburbId,
    street: located.street,
    description,
    date: empty.date,
    time: empty.time,
    attendance: empty.attendance,
    vehicle: vehicleFrom(textOf(args?.vehicle), passage),
    person: personFrom(textOf(args?.person), passage),
  };
}
