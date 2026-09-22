/**
 * Occurrence Book catalogues and rules.
 * Source: docs/ob-book-approval.html — OB-BOOK-SPEC-001 v1.3 (17 Sep 2026).
 * Operators pick a category and types. Danger is computed from the type class
 * plus Alpha (still happening) or Bravo (already over). It is not a P1–P4.
 */

export type ObCategory = "criminal" | "emergency" | "of_interest" | "other";
export type ObReportGroup = "contact" | "property" | "trespass" | "other_criminal";
export type ObDangerClass = "contact" | "property" | "book_only" | "none";
export type ObPhase = "alpha" | "bravo";
export type ObDangerLevel = "leave_to_police" | "caution" | "respond" | "no_response";
export type ObStatus = "active" | "closed";
export type ObAttendance = "present" | "assisting" | "not_present";

export interface ObIncidentType {
  key: string;
  name: string;
  code: string | null;
  category: ObCategory;
  reportGroup: ObReportGroup | null;
  dangerClass: ObDangerClass;
}

export const OB_CATEGORIES: { key: ObCategory; label: string }[] = [
  { key: "criminal", label: "Criminal" },
  { key: "emergency", label: "Emergency" },
  { key: "of_interest", label: "Of Interest" },
  { key: "other", label: "Other" },
];

export const OB_REPORT_GROUPS: { key: ObReportGroup; label: string }[] = [
  { key: "contact", label: "Contact crime and other serious crime" },
  { key: "property", label: "Property crime" },
  { key: "trespass", label: "Trespassing / wall jumpers" },
  { key: "other_criminal", label: "Other criminal" },
];

function cr(
  key: string,
  name: string,
  code: string | null,
  reportGroup: ObReportGroup,
  dangerClass: ObDangerClass,
): ObIncidentType {
  return { key, name, code, category: "criminal", reportGroup, dangerClass };
}

function em(key: string, name: string, code: string | null): ObIncidentType {
  return { key, name, code, category: "emergency", reportGroup: null, dangerClass: "none" };
}

function oi(key: string, name: string): ObIncidentType {
  return { key, name, code: null, category: "of_interest", reportGroup: null, dangerClass: "none" };
}

function ot(key: string, name: string): ObIncidentType {
  return { key, name, code: null, category: "other", reportGroup: null, dangerClass: "none" };
}

/** Le Roux spreadsheet 8 Sep 2026, plus SAPS 104–108. Order matches the BRD. */
export const OB_TYPES: ObIncidentType[] = [
  cr("abduction", "Abduction", "046", "contact", "contact"),
  cr("animal_abuse", "Animal Abuse", "063", "other_criminal", "book_only"),
  cr("armed_robbery", "Armed Robbery", "023", "contact", "contact"),
  cr("armed_robbery_person", "Armed Robbery – Person", "107", "contact", "contact"),
  cr("arson", "Arson", "036", "property", "property"),
  cr("assault", "Assault", "011", "contact", "contact"),
  cr("assault_gbh", "Assault GBH", "010", "contact", "contact"),
  cr("atm_robbery", "ATM Robbery", "106", "contact", "contact"),
  cr("attempted_child_abuse", "Attempted Child Abuse", "027C", "contact", "contact"),
  cr("attempted_robbery", "Attempted Robbery", "024C", "contact", "contact"),
  cr("attempted_armed_robbery", "Attempted Armed Robbery", "023C", "contact", "contact"),
  cr("attempted_atm_robbery", "Attempted ATM Robbery", "106C", "contact", "contact"),
  cr("attempted_bank_robbery", "Attempted Bank Robbery", "104C", "contact", "contact"),
  cr("attempted_business_robbery", "Attempted Business Robbery", "102C", "contact", "contact"),
  cr("attempted_cable_theft", "Attempted Cable Theft", null, "property", "property"),
  cr("attempted_car_jacking", "Attempted Car Jacking", "100C", "contact", "contact"),
  cr("attempted_cit", "Attempted Cash in Transit Robbery", "105C", "contact", "contact"),
  cr("attempted_drowning", "Attempted Drowning", "080C", "other_criminal", "book_only"),
  cr("attempted_hijack_truck", "Attempted Hi-Jacking of Truck", "101C", "contact", "contact"),
  cr("attempted_house_breaking", "Attempted House Breaking", "014C", "property", "property"),
  cr("attempted_house_robbery", "Attempted House Robbery", "103C", "contact", "contact"),
  cr("attempted_indecent_assault", "Attempted Indecent Assault", "043C", "contact", "contact"),
  cr("attempted_malicious_damage", "Attempted Malicious Damage", "017C", "property", "property"),
  cr("attempted_murder", "Attempted Murder", "022C", "contact", "contact"),
  cr("attempted_rape", "Attempted Rape", "021C", "contact", "contact"),
  cr("attempted_shooting", "Attempted Shooting", "019C", "contact", "contact"),
  cr("attempted_stock_theft", "Attempted Stock Theft", null, "property", "property"),
  cr("attempted_theft_of_vehicle", "Attempted Theft of Vehicle", "015C", "property", "property"),
  cr("attempted_theft_out_of_vehicle", "Attempted Theft out of Vehicle", "016C", "property", "property"),
  cr("bank_robbery", "Bank Robbery", "104", "contact", "contact"),
  cr("bomb_exploding", "Bomb Exploding", "031", "contact", "contact"),
  cr("bomb_threat", "Bomb Threat", "032", "contact", "contact"),
  cr("business_robbery", "Business Robbery", "102", "contact", "contact"),
  cr("cable_theft", "Cable Theft", null, "property", "property"),
  cr("car_jacking", "Car Jacking", "100", "contact", "contact"),
  cr("cit_robbery", "Cash in Transit Robbery", "105", "contact", "contact"),
  cr("child_abuse", "Child Abuse", "027", "contact", "contact"),
  cr("crimen_injuria", "Crimen Injuria", "042", "other_criminal", "book_only"),
  cr("dangerous_animal", "Dangerous Animal", "074", "other_criminal", "book_only"),
  cr("desecration_of_grave", "Desecration of Grave", "065", "other_criminal", "book_only"),
  cr("disturbing_the_peace", "Disturbing the Peace", "029", "other_criminal", "book_only"),
  cr("domestic_violence", "Domestic Violence", "092", "contact", "contact"),
  cr("drive_under_influence", "Drive under Influence", "050", "other_criminal", "book_only"),
  cr("drowning", "Drowning", "080", "other_criminal", "book_only"),
  cr("drunkenness", "Drunkenness", "041", "other_criminal", "book_only"),
  cr("dumping_chemicals", "Dumping Chemicals", "098", "other_criminal", "book_only"),
  cr("escaping", "Escaping", "045", "other_criminal", "book_only"),
  cr("fighting", "Fighting", "012", "contact", "contact"),
  cr("fraud", "Fraud", "034", "property", "book_only"),
  cr("gang_fighting", "Gang Fighting", "048", "contact", "contact"),
  cr("gathering", "Gathering", "056", "other_criminal", "book_only"),
  cr("hijack_truck", "Hi-Jacking of Truck", "101", "contact", "contact"),
  cr("hit_by_train", "Hit by Train", "057", "other_criminal", "book_only"),
  cr("hostage", "Hostage Situation", "020", "contact", "contact"),
  cr("house_breaking", "House Breaking", "014", "property", "property"),
  cr("house_robbery", "House Robbery", "103", "contact", "contact"),
  cr("illegal_strikes", "Illegal Strikes", "069", "other_criminal", "book_only"),
  cr("incest", "Incest", "066", "contact", "contact"),
  cr("indecent_assault", "Indecent Assault", "043", "contact", "contact"),
  cr("injured_person", "Injured Person", "062", "other_criminal", "book_only"),
  cr("interdict", "Interdict", "073", "other_criminal", "book_only"),
  cr("intimidation", "Intimidation", "033", "contact", "contact"),
  cr("kidnapping", "Kidnapping", "088", "contact", "contact"),
  cr("loitering", "Loitering", "086", "other_criminal", "book_only"),
  cr("lost_property", "Lost Property", "082", "other_criminal", "book_only"),
  cr("malicious_damage", "Malicious Damage", "017", "property", "property"),
  cr("mentally_deranged", "Mentally Deranged", "078", "other_criminal", "book_only"),
  cr("mentally_disturbed", "Mentally Disturbed", "064", "other_criminal", "book_only"),
  cr("missing_on_mountain", "Missing on Mountain", "087", "other_criminal", "book_only"),
  cr("missing_person", "Missing Person", "047", "other_criminal", "book_only"),
  cr("murder", "Murder", "022", "contact", "contact"),
  cr("pointing_of_firearm", "Pointing of Firearm", "077", "contact", "contact"),
  cr("possess_drugs", "Possess/Deal in Drugs", "054", "other_criminal", "book_only"),
  cr("possession_dangerous_weapons", "Possession Dangerous Weapons", "052", "other_criminal", "book_only"),
  cr("possession_stolen_goods", "Possession Stolen Goods", "049", "property", "book_only"),
  cr("protest_march", "Protest March", "070", "other_criminal", "book_only"),
  cr("public_indecency", "Public Indecency", "085", "other_criminal", "book_only"),
  cr("rape", "Rape", "021", "contact", "contact"),
  cr("rebellious_person", "Rebellious Person", "075", "other_criminal", "book_only"),
  cr("recovered_property", "Recovered Property", "072", "property", "book_only"),
  cr("riots", "Riots", "068", "contact", "contact"),
  cr("robbery", "Robbery", "024", "contact", "contact"),
  cr("robbery_from_person", "Robbery from Person", "108", "contact", "contact"),
  cr("shooting", "Shooting", "019", "contact", "contact"),
  cr("shoplifting", "Shoplifting", "044", "property", "property"),
  cr("stock_theft", "Stock Theft", "053", "property", "property"),
  cr("stone_throwing", "Stone Throwing", "030", "contact", "contact"),
  cr("sudden_death", "Sudden Death", "079", "other_criminal", "book_only"),
  cr("suicide", "Suicide", "055", "other_criminal", "book_only"),
  cr("theft", "Theft", "013", "property", "property"),
  cr("theft_of_vehicle", "Theft of Vehicle", "015", "property", "property"),
  cr("theft_out_of_vehicle", "Theft out of Vehicle", "016", "property", "property"),
  cr("theft_with_detention", "Theft with Detention", "058", "property", "property"),
  cr("traffic_offence", "Traffic Offence", "081", "other_criminal", "book_only"),
  cr("trespassing", "Trespassing", "028", "trespass", "property"),
  cr("unnatural_death", "Unnatural Death", "052", "other_criminal", "book_only"),
  cr("use_vehicle_without_consent", "Use Vehicle without Consent", "018", "property", "property"),
  cr("wanted_person", "Wanted Person", "084", "other_criminal", "book_only"),

  em("fire_building", "Fire (House/Building/Factory)", "035"),
  em("fire_vehicle", "Fire (Vehicle)", "035"),
  em("fire_veld", "Fire (Veld/Field/Stand)", "035"),
  em("attempted_suicide", "Attempted Suicide", "055C"),
  em("flooding", "Flooding", null),
  em("lightning", "Lightning / storm damage", null),
  em("mba", "MBA (Motor Bike Accident)", null),
  em("medical", "Medical Emergency", null),
  em("mva", "MVA (Motor Vehicle Accident)", null),
  em("pva", "PVA (Pedestrian Vehicle Accident)", null),
  em("sinkhole", "Sinkhole", null),
  em("tree_fallen", "Tree Fallen Over", null),
  em("emergency_other", "Other", null),

  oi("vehicle_of_interest", "Vehicle of Interest"),
  oi("person_of_interest", "Person of Interest"),
  oi("place_of_interest", "Place of Interest"),

  ot("note", "Note"),
  ot("bolo", "BOLO"),
  ot("drive_by", "Drive by Request"),
  ot("open_gate", "Open Gate"),
  ot("metro_by_law", "Metro By-Law (e.g. fireworks)"),
  ot("commence_shift", "Commence Shift"),
];

const TYPE_BY_KEY = new Map(OB_TYPES.map((t) => [t.key, t]));

export function obType(key: string): ObIncidentType | undefined {
  return TYPE_BY_KEY.get(key);
}

export function obTypesFor(category: ObCategory): ObIncidentType[] {
  return OB_TYPES.filter((t) => t.category === category);
}

export const OB_CONCLUSIONS = [
  "All in Order - Nothing Found",
  "Authorities notified",
  "No feedback received",
  "Scene Handed over to Authorities",
  "Scene Cleared - Patients Transported",
  "Scene Cleared",
  "Captured for Information Only",
  "Other",
] as const;

export type ObConclusion = (typeof OB_CONCLUSIONS)[number];

export const OB_RECEIVED_FROM = [
  "Emergency Number",
  "CPF Group",
  "Other Groups",
  "CPF Member / Patroller",
  "Other",
] as const;

export type ObReceivedFrom = (typeof OB_RECEIVED_FROM)[number];

export interface ObServiceDef {
  key: string;
  label: string;
  referenceLabel: string | null;
}

export const OB_SERVICES: ObServiceDef[] = [
  { key: "saps", label: "SA Police Services", referenceLabel: "SAPS Reference" },
  { key: "metro", label: "Tshwane Metro Police", referenceLabel: "Metro Police Reference" },
  { key: "ambulance_private", label: "Ambulance (Private)", referenceLabel: "Ambulance Reference" },
  { key: "ambulance_state", label: "Ambulance (State)", referenceLabel: "Ambulance Reference" },
  { key: "cert", label: "CERT", referenceLabel: null },
  { key: "paramedic", label: "Paramedic", referenceLabel: "Ambulance Reference" },
  { key: "fire", label: "Fire Brigade", referenceLabel: "Fire Brigade Reference" },
  { key: "trauma", label: "Trauma Counseling", referenceLabel: null },
  { key: "cot", label: "City of Tshwane", referenceLabel: null },
  { key: "other", label: "Other", referenceLabel: null },
];

export const OB_TAGS: { key: string; label: string }[] = [
  { key: "remote_jamming", label: "Remote Jamming" },
  { key: "gate_motor", label: "Gate Motor" },
  { key: "cable_theft", label: "Cable Theft" },
  { key: "beams", label: "Beams" },
  { key: "bicycle", label: "Bicycle" },
  { key: "wall_jumper", label: "Wall Jumper" },
  { key: "smash_n_grab", label: "Smash-n-Grab" },
  { key: "dog_poisoning", label: "Dog Poisoning" },
  { key: "fireworks", label: "Fireworks" },
  { key: "information_only", label: "Information only" },
];

export const OB_INJURY_TAGS = [
  { key: "injuries_p1", label: "Injuries - P1", meaning: "Code Red — life and death / critical" },
  { key: "injuries_p2", label: "Injuries - P2", meaning: "Code Yellow — hurt but not critical" },
  { key: "injuries_p3", label: "Injuries - P3", meaning: "Code Green — walking wounded / stable" },
  { key: "injuries_p4", label: "Injuries - P4", meaning: "Code Blue — deceased" },
] as const;

export const OB_VOI_COLOURS = [
  "Black", "White", "Silver", "Grey", "Red", "Blue", "Green", "Yellow", "Orange", "Brown", "Gold", "Maroon", "Other",
] as const;

export const OB_VOI_SHAPES = [
  "Sedan", "Hatchback", "SUV / 4x4", "Bakkie / Truck", "Van / Minibus", "Motorcycle", "Bus", "Other",
] as const;

export const OB_POI_GENDERS = ["Male", "Female", "Unknown"] as const;

export const OB_TIME_BANDS: { label: string; fromMin: number; toMin: number; range: string }[] = [
  { label: "During the Night", fromMin: 0, toMin: 4 * 60, range: "00:00 - 04:00" },
  { label: "Early Morning", fromMin: 4 * 60, toMin: 8 * 60, range: "04:00 - 08:00" },
  { label: "Morning", fromMin: 8 * 60, toMin: 12 * 60, range: "08:00 - 12:00" },
  { label: "Afternoon", fromMin: 12 * 60, toMin: 16 * 60, range: "12:00 - 16:00" },
  { label: "Late Afternoon", fromMin: 16 * 60, toMin: 18 * 60, range: "16:00 - 18:00" },
  { label: "Evening", fromMin: 18 * 60, toMin: 22 * 60, range: "18:00 - 22:00" },
  { label: "Late Evening", fromMin: 22 * 60, toMin: 24 * 60, range: "22:00 - 24:00" },
];

export const OB_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const DEFAULT_SUBURBS: { name: string; aliases: string[] }[] = [
  { name: "Clubview", aliases: [] },
  { name: "Hennopspark", aliases: [] },
  { name: "Valhalla", aliases: ["Monrich"] },
  { name: "Wierdapark", aliases: [] },
  { name: "Bronberrick", aliases: [] },
  { name: "Lyttelton", aliases: ["Lyttleton"] },
  { name: "Eldoglen", aliases: [] },
  { name: "Eldoraigne", aliases: [] },
  { name: "Heuweloord", aliases: [] },
  { name: "Centurion Central", aliases: ["Centurion"] },
  { name: "Rooihuiskraal", aliases: [] },
  { name: "The Reeds", aliases: [] },
  { name: "Cranbrook Vale", aliases: [] },
  { name: "Zwartkop", aliases: [] },
  { name: "Die Hoewes", aliases: [] },
  { name: "Raslouw", aliases: [] },
  { name: "Sunderland Ridge", aliases: [] },
  { name: "Highveld", aliases: [] },
  { name: "Southdowns", aliases: [] },
  { name: "Celtis Ridge", aliases: [] },
  { name: "Monrick", aliases: [] },
  { name: "Glen Lauriston", aliases: [] },
  { name: "Laudium", aliases: [] },
];

export const DANGER_LEVELS: { key: ObDangerLevel; label: string; instruction: string }[] = [
  {
    key: "leave_to_police",
    label: "Leave to police",
    instruction:
      "Do not attend the scene. This is for SAPS and armed response only. If you are already nearby, stay at a safe distance and observe. Do not approach armed suspects, a shooting, a hijacking, a hostage situation, or similar.",
  },
  {
    key: "caution",
    label: "Caution",
    instruction:
      "You may attend if asked or if you are already close, but treat the scene as still dangerous. Do not go in alone if suspects may still be there. Wait for backup or armed response if needed.",
  },
  {
    key: "respond",
    label: "Respond",
    instruction: "Normal CPF attendance. Go, check, help residents, take details and photos, and write it in the book.",
  },
  {
    key: "no_response",
    label: "No response",
    instruction: "For the book only. No need to send a patroller unless someone specifically asks.",
  },
];

const DANGER_RANK: Record<ObDangerLevel, number> = {
  leave_to_police: 3,
  caution: 2,
  respond: 1,
  no_response: 0,
};

export function dangerLevelFor(dangerClass: ObDangerClass, phase: ObPhase): ObDangerLevel {
  if (dangerClass === "book_only" || dangerClass === "none") return "no_response";
  if (dangerClass === "contact") return phase === "alpha" ? "leave_to_police" : "caution";
  return phase === "alpha" ? "caution" : "respond";
}

/** Strictest danger across the chosen types. Primary type stays first for reports. */
export function dangerForTypes(typeKeys: string[], phase: ObPhase | null): ObDangerLevel | null {
  if (!phase) return null;
  let best: ObDangerLevel | null = null;
  for (const key of typeKeys) {
    const type = obType(key);
    if (!type || type.category !== "criminal") continue;
    const level = dangerLevelFor(type.dangerClass, phase);
    if (!best || DANGER_RANK[level] > DANGER_RANK[best]) best = level;
  }
  return best;
}

export function dangerMeta(level: ObDangerLevel | null) {
  if (!level) return null;
  return DANGER_LEVELS.find((d) => d.key === level) ?? null;
}

export function typeLabel(type: ObIncidentType, phase: ObPhase | null): string {
  const code = type.code ? `${type.code}${phase ? phase[0]!.toUpperCase() : ""}` : phase ? phase[0]!.toUpperCase() : "";
  return code ? `${type.name} (${code})` : type.name;
}

/** WBS1 → S1, WBS2 → S2. Already-S codes stay. Example: S1/215/2026. */
export function obPrefixFromSectorCode(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  const wbs = raw.match(/^WBS(\d+)$/i);
  if (wbs) return `S${wbs[1]}`;
  const sierra = raw.match(/^S(\d+)$/i);
  if (sierra) return `S${sierra[1]}`;
  return raw ? raw.toUpperCase() : "S";
}

export function formatObNumber(prefix: string, sequence: number, year: number): string {
  return `${prefix}/${sequence}/${year}`;
}

export function timeBand(hour: number, minute: number) {
  const mins = hour * 60 + minute;
  return OB_TIME_BANDS.find((b) => mins >= b.fromMin && mins < b.toMin) ?? OB_TIME_BANDS[0]!;
}

/** Calendar date the operator typed, not shifted by UTC. */
export function weekdayFromDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map((n) => Number(n));
  if (!y || !m || !d) return "";
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return OB_WEEKDAYS[day] ?? "";
}

export function parseLocalWhen(date: string, time: string): {
  occurredAt: string;
  year: number;
  hour: number;
  minute: number;
  timeOfDay: string;
  dayOfWeek: string;
} | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const [y, m, d] = date.split("-").map((n) => Number(n));
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m! - 1 || probe.getUTCDate() !== d) return null;
  const band = timeBand(hour, minute);
  return {
    occurredAt: `${date} ${match[1]}:${match[2]}:00`,
    year: y!,
    hour,
    minute,
    timeOfDay: band.label,
    dayOfWeek: weekdayFromDate(date),
  };
}

/** Drop a leading house number for the community post. "12 Myrdal Rd" → "Myrdal Rd". */
export function streetNameOnly(street: string): string {
  const stripped = street.replace(/^\s*\d+[a-zA-Z]?(?:\s*[,/-]\s*|\s+)/, "").trim();
  return stripped || street.trim();
}

export function requiresAttendance(category: ObCategory, typeKeys: string[]): boolean {
  if (category === "emergency") return true;
  return typeKeys.includes("metro_by_law");
}

/** Rape and suicide stay in the book and off the community WhatsApp post. */
export function excludedFromCommunityPost(typeKeys: string[]): boolean {
  return typeKeys.some((k) => k === "rape" || k === "attempted_rape" || k === "suicide");
}

export function categoryLabel(category: ObCategory): string {
  return OB_CATEGORIES.find((c) => c.key === category)?.label ?? category;
}
