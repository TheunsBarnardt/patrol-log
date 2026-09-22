// Occurrence book — OB-BOOK-SPEC-001 v1.3
// Call centre / sector lead capture. Phone, photos, and reports follow.

import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import {
  AppError,
  DEFAULT_SUBURBS,
  OB_CONCLUSIONS,
  OB_INJURY_TAGS,
  OB_POI_GENDERS,
  OB_RECEIVED_FROM,
  OB_SERVICES,
  OB_TAGS,
  OB_VOI_COLOURS,
  OB_VOI_SHAPES,
  dangerForTypes,
  formatObNumber,
  obPrefixFromSectorCode,
  obType,
  parseLocalWhen,
  requiresAttendance,
  type ObAttendance,
  type ObCategory,
  type ObPhase,
} from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { getAuth, requireAccessLevel, requireAuth } from "../lib/middleware.js";
import { getDb, type Db } from "../db/index.js";
import {
  obEntries,
  obEntryResponders,
  obEntryServices,
  obEntryTags,
  obEntryTypes,
  obPersons,
  obSecurityCompanies,
  obSightings,
  obSuburbs,
  obVehicles,
  patrolMembers,
  patrollers,
  patrols,
  sectors,
} from "../db/schema.js";
import { logAudit } from "../lib/audit.js";
import { assertSectorAccess, tenantScope } from "../lib/scope.js";
import type { AuthenticatedContext } from "../env.js";

const ob = new Hono<AppContext>();
ob.use("*", requireAuth(), requireAccessLevel("system_admin", "admin", "sector_lead", "call_centre_agent"));

const CATEGORIES = new Set<ObCategory>(["criminal", "emergency", "of_interest", "other"]);
const SERVICE_KEYS = new Set(OB_SERVICES.map((s) => s.key));
const TAG_KEYS = new Set(OB_TAGS.map((t) => t.key));
const INJURY_KEYS = new Set<string>(OB_INJURY_TAGS.map((t) => t.key));
const COLOURS = new Set<string>(OB_VOI_COLOURS);
const SHAPES = new Set<string>(OB_VOI_SHAPES);
const GENDERS = new Set<string>(OB_POI_GENDERS);
const RECEIVED = new Set<string>(OB_RECEIVED_FROM);

interface ServiceInput {
  key: string;
  reference?: string | null;
  other_name?: string | null;
  security_company_id?: string | null;
}
interface VehicleInput {
  colour?: string | null;
  shape?: string | null;
  make?: string | null;
  model?: string | null;
  registration?: string | null;
  features?: string | null;
}
interface PersonInput {
  kind?: string;
  gender?: string | null;
  clothing?: string | null;
  direction?: string | null;
  injury_tag?: string | null;
  note?: string | null;
}
interface WriteBody {
  sector_id?: string;
  category?: string;
  type_keys?: string[];
  phase?: string | null;
  date?: string;
  time?: string;
  received_from?: string[];
  attendance?: string | null;
  suburb_id?: string | null;
  street?: string;
  lat?: number | null;
  lng?: number | null;
  description?: string;
  action_details?: string;
  tag_keys?: string[];
  responder_ids?: string[];
  services?: ServiceInput[];
  vehicles?: VehicleInput[];
  persons?: PersonInput[];
}

interface Normalized {
  category: ObCategory;
  typeKeys: string[];
  phase: ObPhase | null;
  dangerLevel: ReturnType<typeof dangerForTypes>;
  when: NonNullable<ReturnType<typeof parseLocalWhen>>;
  receivedFrom: string[];
  attendance: ObAttendance | null;
  suburbId: string | null;
  street: string;
  lat: number | null;
  lng: number | null;
  description: string;
  actionDetails: string;
  tagKeys: string[];
  responderIds: string[];
  services: { key: string; reference: string | null; otherName: string | null; securityCompanyId: string | null }[];
  vehicles: { colour: string | null; shape: string | null; make: string | null; model: string | null; registration: string | null; features: string | null }[];
  persons: { kind: "poi" | "patient"; gender: string | null; clothing: string | null; direction: string | null; injuryTag: string | null; note: string | null }[];
}

function canMaintainCompanies(auth: AuthenticatedContext): boolean {
  return ["system_admin", "admin", "sector_lead"].includes(auth.patroller.access_level);
}

function blank(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function nowSast(): { date: string; time: string } {
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

async function ensureSuburbs(db: Db, cpfId: string) {
  const existing = await db.select({ id: obSuburbs.id }).from(obSuburbs).where(eq(obSuburbs.cpfId, cpfId)).limit(1);
  if (existing.length) return;
  await db.insert(obSuburbs).values(
    DEFAULT_SUBURBS.map((s, i) => ({
      cpfId,
      name: s.name,
      aliases: s.aliases,
      sortOrder: i + 1,
    })),
  );
}

async function resolveSector(db: Db, auth: AuthenticatedContext, requested?: string | null) {
  const sectorId = requested || auth.patroller.sector_id;
  if (!assertSectorAccess(auth, sectorId)) throw new AppError("ACCESS_FORBIDDEN");
  const sector = await db.query.sectors.findFirst({
    where: and(eq(sectors.id, sectorId), eq(sectors.cpfId, auth.patroller.cpf_id)),
  });
  if (!sector) throw new AppError("SECTOR_NOT_FOUND");
  return sector;
}

async function nextSequence(dbBinding: AppContext["Bindings"]["DB"], sectorId: string, year: number): Promise<number> {
  const row = await dbBinding
    .prepare(
      `INSERT INTO ob_sequences (sector_id, year, last_seq)
       VALUES (?1, ?2, 1)
       ON CONFLICT(sector_id, year) DO UPDATE SET last_seq = ob_sequences.last_seq + 1
       RETURNING last_seq`,
    )
    .bind(sectorId, year)
    .first<{ last_seq: number }>();
  const seq = Number(row?.last_seq);
  if (!Number.isFinite(seq) || seq < 1) throw new AppError("OB_INVALID_INPUT");
  return seq;
}

function normalize(body: WriteBody, opts: { commenceShift?: boolean }): Normalized {
  const source: WriteBody = opts.commenceShift
    ? {
        ...body,
        category: "other",
        type_keys: ["commence_shift"],
        phase: null,
        attendance: null,
        suburb_id: null,
        received_from: body.received_from?.length ? body.received_from : ["CPF Member / Patroller"],
        description: body.description ?? "Commence Shift",
      }
    : body;

  const category = source.category as ObCategory;
  if (!CATEGORIES.has(category)) throw new AppError("OB_INVALID_INPUT");

  const typeKeys = [...new Set((source.type_keys ?? []).map((k) => k.trim()).filter(Boolean))];
  if (!typeKeys.length) throw new AppError("OB_INVALID_INPUT");
  for (const key of typeKeys) {
    const type = obType(key);
    if (!type || type.category !== category) throw new AppError("OB_INVALID_INPUT");
  }

  let phase: ObPhase | null = null;
  if (category === "criminal") {
    if (source.phase !== "alpha" && source.phase !== "bravo") throw new AppError("OB_PHASE_REQUIRED");
    phase = source.phase;
  }

  const when = parseLocalWhen(source.date ?? "", source.time ?? "");
  if (!when) throw new AppError("OB_INVALID_INPUT");

  const receivedFrom = [...new Set((source.received_from ?? []).map((r) => r.trim()).filter(Boolean))];
  if (!opts.commenceShift && !receivedFrom.length) throw new AppError("OB_INVALID_INPUT");
  if (receivedFrom.some((r) => !RECEIVED.has(r))) throw new AppError("OB_INVALID_INPUT");

  let attendance: ObAttendance | null = null;
  if (source.attendance === "present" || source.attendance === "assisting" || source.attendance === "not_present") {
    attendance = source.attendance;
  }
  if (requiresAttendance(category, typeKeys) && attendance !== "present" && attendance !== "assisting") {
    throw new AppError("OB_ATTENDANCE_REQUIRED");
  }

  const suburbId = blank(source.suburb_id) || null;
  if (!opts.commenceShift && !suburbId) throw new AppError("OB_SUBURB_REQUIRED");

  const description = (source.description ?? "").trim();
  if (!opts.commenceShift && !description) throw new AppError("OB_INVALID_INPUT");

  const latRaw = source.lat;
  const lngRaw = source.lng;
  let lat: number | null = latRaw == null || (latRaw as unknown) === "" ? null : Number(latRaw);
  let lng: number | null = lngRaw == null || (lngRaw as unknown) === "" ? null : Number(lngRaw);
  const latEmpty = lat == null || Number.isNaN(lat);
  const lngEmpty = lng == null || Number.isNaN(lng);
  if (latEmpty && lngEmpty) {
    lat = null;
    lng = null;
  } else if (
    latEmpty ||
    lngEmpty ||
    lat == null ||
    lng == null ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new AppError("OB_INVALID_INPUT");
  }

  const tagKeys = [...new Set((source.tag_keys ?? []).map((k) => k.trim()).filter(Boolean))];
  if (tagKeys.some((k) => !TAG_KEYS.has(k))) throw new AppError("OB_INVALID_INPUT");
  if (attendance === "not_present" && !tagKeys.includes("information_only")) tagKeys.push("information_only");

  const services = (source.services ?? [])
    .map((s) => ({
      key: (s.key ?? "").trim(),
      reference: blank(s.reference) || null,
      otherName: blank(s.other_name) || null,
      securityCompanyId: blank(s.security_company_id) || null,
    }))
    .filter((s) => s.key);
  for (const s of services) {
    if (s.key === "security") {
      if (!s.securityCompanyId) throw new AppError("OB_INVALID_INPUT");
    } else if (!SERVICE_KEYS.has(s.key)) {
      throw new AppError("OB_INVALID_INPUT");
    }
  }

  const vehicles = (source.vehicles ?? [])
    .map((v) => ({
      colour: blank(v.colour) || null,
      shape: blank(v.shape) || null,
      make: blank(v.make) || null,
      model: blank(v.model) || null,
      registration: blank(v.registration).toUpperCase() || null,
      features: blank(v.features) || null,
    }))
    .filter((v) => v.colour || v.shape || v.make || v.model || v.registration || v.features);
  for (const v of vehicles) {
    if (v.colour && !COLOURS.has(v.colour)) throw new AppError("OB_INVALID_INPUT");
    if (v.shape && !SHAPES.has(v.shape)) throw new AppError("OB_INVALID_INPUT");
  }

  const persons: Normalized["persons"] = (source.persons ?? []).flatMap((p) => {
    if (p.kind !== "patient" && p.kind !== "poi") return [];
    const kind: "poi" | "patient" = p.kind === "patient" ? "patient" : "poi";
    const row = {
      kind,
      gender: blank(p.gender) || null,
      clothing: blank(p.clothing) || null,
      direction: blank(p.direction) || null,
      injuryTag: blank(p.injury_tag) || null,
      note: blank(p.note) || null,
    };
    if (!row.gender && !row.clothing && !row.direction && !row.injuryTag && !row.note) return [];
    return [row];
  });
  for (const p of persons) {
    if (p.gender && !GENDERS.has(p.gender)) throw new AppError("OB_INVALID_INPUT");
    if (p.injuryTag && !INJURY_KEYS.has(p.injuryTag)) throw new AppError("OB_INVALID_INPUT");
    if (p.kind === "patient" && !p.injuryTag) throw new AppError("OB_INVALID_INPUT");
  }

  return {
    category,
    typeKeys,
    phase,
    dangerLevel: phase ? dangerForTypes(typeKeys, phase) : null,
    when,
    receivedFrom,
    attendance,
    suburbId,
    street: (source.street ?? "").trim(),
    lat,
    lng,
    description,
    actionDetails: (source.action_details ?? "").trim(),
    tagKeys,
    responderIds: [...new Set((source.responder_ids ?? []).map((id) => id.trim()).filter(Boolean))],
    services,
    vehicles,
    persons,
  };
}

async function assertSuburb(db: Db, cpfId: string, suburbId: string | null) {
  if (!suburbId) return;
  const row = await db.query.obSuburbs.findFirst({
    where: and(eq(obSuburbs.id, suburbId), eq(obSuburbs.cpfId, cpfId)),
  });
  if (!row) throw new AppError("OB_SUBURB_REQUIRED");
}

async function assertResponders(db: Db, auth: AuthenticatedContext, sectorId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await db
    .select({ id: patrollers.id })
    .from(patrollers)
    .where(and(eq(patrollers.cpfId, auth.patroller.cpf_id), eq(patrollers.sectorId, sectorId), inArray(patrollers.id, ids)));
  if (rows.length !== ids.length) throw new AppError("OB_INVALID_INPUT");
}

async function assertCompanies(db: Db, cpfId: string, services: Normalized["services"]) {
  const ids = [...new Set(services.map((s) => s.securityCompanyId).filter((id): id is string => !!id))];
  if (!ids.length) return;
  const rows = await db
    .select({ id: obSecurityCompanies.id })
    .from(obSecurityCompanies)
    .where(and(eq(obSecurityCompanies.cpfId, cpfId), eq(obSecurityCompanies.active, true), inArray(obSecurityCompanies.id, ids)));
  if (rows.length !== ids.length) throw new AppError("OB_INVALID_INPUT");
}

async function replaceChildren(db: Db, entryId: string, norm: Normalized) {
  await db.delete(obEntryTypes).where(eq(obEntryTypes.entryId, entryId));
  await db.delete(obEntryServices).where(eq(obEntryServices.entryId, entryId));
  await db.delete(obEntryResponders).where(eq(obEntryResponders.entryId, entryId));
  await db.delete(obEntryTags).where(eq(obEntryTags.entryId, entryId));
  await db.delete(obVehicles).where(eq(obVehicles.entryId, entryId));
  await db.delete(obPersons).where(eq(obPersons.entryId, entryId));

  await db.insert(obEntryTypes).values(
    norm.typeKeys.map((typeKey, i) => ({
      entryId,
      typeKey,
      isPrimary: i === 0,
      sortOrder: i,
    })),
  );
  if (norm.services.length) {
    await db.insert(obEntryServices).values(
      norm.services.map((s) => ({
        entryId,
        serviceKey: s.key,
        securityCompanyId: s.securityCompanyId,
        reference: s.reference,
        otherName: s.otherName,
      })),
    );
  }
  if (norm.responderIds.length) {
    await db.insert(obEntryResponders).values(norm.responderIds.map((patrollerId) => ({ entryId, patrollerId })));
  }
  if (norm.tagKeys.length) {
    await db.insert(obEntryTags).values(norm.tagKeys.map((tagKey) => ({ entryId, tagKey })));
  }
  if (norm.vehicles.length) await db.insert(obVehicles).values(norm.vehicles.map((v) => ({ entryId, ...v })));
  if (norm.persons.length) await db.insert(obPersons).values(norm.persons.map((p) => ({ entryId, ...p })));
}

function splitWhen(occurredAt: string): { date: string; time: string } {
  const [date, clock] = occurredAt.split(" ");
  return { date: date ?? "", time: (clock ?? "").slice(0, 5) };
}

async function presentEntry(db: Db, entry: typeof obEntries.$inferSelect) {
  const [types, services, responders, tags, vehicles, persons, sightings, suburb] = await Promise.all([
    db.select().from(obEntryTypes).where(eq(obEntryTypes.entryId, entry.id)).orderBy(asc(obEntryTypes.sortOrder)),
    db.select().from(obEntryServices).where(eq(obEntryServices.entryId, entry.id)),
    db.select().from(obEntryResponders).where(eq(obEntryResponders.entryId, entry.id)),
    db.select().from(obEntryTags).where(eq(obEntryTags.entryId, entry.id)),
    db.select().from(obVehicles).where(eq(obVehicles.entryId, entry.id)),
    db.select().from(obPersons).where(eq(obPersons.entryId, entry.id)),
    db.select().from(obSightings).where(eq(obSightings.entryId, entry.id)).orderBy(desc(obSightings.seenAt)),
    entry.suburbId
      ? db.query.obSuburbs.findFirst({ where: eq(obSuburbs.id, entry.suburbId) })
      : Promise.resolve(null),
  ]);
  const when = splitWhen(entry.occurredAt);
  return {
    id: entry.id,
    obNumber: entry.obNumber,
    status: entry.status,
    sectorId: entry.sectorId,
    category: entry.category,
    phase: entry.phase,
    dangerLevel: entry.dangerLevel,
    occurredAt: entry.occurredAt,
    date: when.date,
    time: when.time,
    timeOfDay: entry.timeOfDay,
    dayOfWeek: entry.dayOfWeek,
    suburbId: entry.suburbId,
    suburbName: suburb?.name ?? null,
    street: entry.street,
    lat: entry.lat,
    lng: entry.lng,
    description: entry.description,
    actionDetails: entry.actionDetails,
    receivedFrom: entry.receivedFrom ?? [],
    attendance: entry.attendance,
    conclusion: entry.conclusion,
    callSign: entry.callSign,
    closedAt: entry.closedAt,
    types: types.map((t) => {
      const def = obType(t.typeKey);
      return { key: t.typeKey, name: def?.name ?? t.typeKey, code: def?.code ?? null, isPrimary: t.isPrimary };
    }),
    services: services.map((s) => ({
      key: s.serviceKey,
      reference: s.reference,
      otherName: s.otherName,
      securityCompanyId: s.securityCompanyId,
    })),
    responderIds: responders.map((r) => r.patrollerId),
    tagKeys: tags.map((t) => t.tagKey),
    vehicles: vehicles.map((v) => ({
      colour: v.colour,
      shape: v.shape,
      make: v.make,
      model: v.model,
      registration: v.registration,
      features: v.features,
    })),
    persons: persons.map((p) => ({
      kind: p.kind,
      gender: p.gender,
      clothing: p.clothing,
      direction: p.direction,
      injuryTag: p.injuryTag,
      note: p.note,
    })),
    sightings: sightings.map((s) => ({
      id: s.id,
      suburbId: s.suburbId,
      street: s.street,
      seenAt: s.seenAt,
      note: s.note,
      callSign: s.callSign,
    })),
  };
}

async function loadOwned(db: Db, auth: AuthenticatedContext, id: string) {
  const entry = await db.query.obEntries.findFirst({ where: eq(obEntries.id, id) });
  if (!entry || entry.cpfId !== auth.patroller.cpf_id || !assertSectorAccess(auth, entry.sectorId)) {
    throw new AppError("OB_NOT_FOUND");
  }
  return entry;
}

ob.get("/meta", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  await ensureSuburbs(db, auth.patroller.cpf_id);
  const sectorId = auth.patroller.access_level === "system_admin" ? null : auth.patroller.sector_id;

  const [suburbRows, companyRows, sectorRows, onPatrol] = await Promise.all([
    db.select().from(obSuburbs).where(eq(obSuburbs.cpfId, auth.patroller.cpf_id)).orderBy(asc(obSuburbs.sortOrder), asc(obSuburbs.name)),
    db
      .select()
      .from(obSecurityCompanies)
      .where(and(eq(obSecurityCompanies.cpfId, auth.patroller.cpf_id), eq(obSecurityCompanies.active, true)))
      .orderBy(asc(obSecurityCompanies.name)),
    db
      .select({ id: sectors.id, name: sectors.name, code: sectors.code })
      .from(sectors)
      .where(sectorId ? and(eq(sectors.cpfId, auth.patroller.cpf_id), eq(sectors.id, sectorId)) : eq(sectors.cpfId, auth.patroller.cpf_id))
      .orderBy(asc(sectors.name)),
    db
      .select({
        id: patrollers.id,
        callSign: patrollers.callSign,
        name: patrollers.name,
        sectorId: patrols.sectorId,
      })
      .from(patrolMembers)
      .innerJoin(patrols, eq(patrolMembers.patrolId, patrols.id))
      .innerJoin(patrollers, eq(patrolMembers.patrollerId, patrollers.id))
      .where(
        and(
          eq(patrols.cpfId, auth.patroller.cpf_id),
          eq(patrols.state, "active"),
          isNull(patrolMembers.endTime),
          sectorId ? eq(patrols.sectorId, sectorId) : undefined,
        ),
      ),
  ]);

  return c.json({
    suburbs: suburbRows.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases ?? [] })),
    securityCompanies: companyRows.map((s) => ({ id: s.id, name: s.name })),
    sectors: sectorRows,
    onPatrol,
    canMaintainCompanies: canMaintainCompanies(auth),
  });
});

ob.get("/entries", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const status = c.req.query("status");
  const q = (c.req.query("q") ?? "").trim();
  const pattern = q ? `%${q.replace(/[%_]/g, "")}%` : null;

  const rows = await db
    .select({ entry: obEntries, suburbName: obSuburbs.name })
    .from(obEntries)
    .leftJoin(obSuburbs, eq(obEntries.suburbId, obSuburbs.id))
    .where(
      and(
        tenantScope(auth, { cpfId: obEntries.cpfId, sectorId: obEntries.sectorId }),
        status === "active" || status === "closed" ? eq(obEntries.status, status) : undefined,
        pattern
          ? or(
              like(obEntries.obNumber, pattern),
              like(obEntries.street, pattern),
              like(obEntries.description, pattern),
              like(obEntries.callSign, pattern),
              like(obSuburbs.name, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(obEntries.occurredAt))
    .limit(400);

  const ids = rows.map((r) => r.entry.id);
  const typeRows = ids.length
    ? await db.select().from(obEntryTypes).where(inArray(obEntryTypes.entryId, ids)).orderBy(asc(obEntryTypes.sortOrder))
    : [];
  const byEntry = new Map<string, typeof typeRows>();
  for (const t of typeRows) {
    const list = byEntry.get(t.entryId) ?? [];
    list.push(t);
    byEntry.set(t.entryId, list);
  }

  return c.json({
    results: rows.map((r) => {
      const types = byEntry.get(r.entry.id) ?? [];
      const primary = types[0];
      const def = primary ? obType(primary.typeKey) : undefined;
      return {
        id: r.entry.id,
        obNumber: r.entry.obNumber,
        status: r.entry.status,
        category: r.entry.category,
        phase: r.entry.phase,
        dangerLevel: r.entry.dangerLevel,
        occurredAt: r.entry.occurredAt,
        timeOfDay: r.entry.timeOfDay,
        dayOfWeek: r.entry.dayOfWeek,
        suburbName: r.suburbName,
        street: r.entry.street,
        callSign: r.entry.callSign,
        conclusion: r.entry.conclusion,
        primaryType: def?.name ?? primary?.typeKey ?? "",
        primaryCode: def?.code ?? null,
        typeCount: types.length,
      };
    }),
  });
});

ob.get("/entries/:id", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const entry = await loadOwned(db, auth, c.req.param("id"));
  return c.json(await presentEntry(db, entry));
});

async function insertEntry(
  c: { env: AppContext["Bindings"] },
  db: Db,
  auth: AuthenticatedContext,
  sector: { id: string; code: string | null },
  norm: Normalized,
) {
  const sequence = await nextSequence(c.env.DB, sector.id, norm.when.year);
  const obNumber = formatObNumber(obPrefixFromSectorCode(sector.code), sequence, norm.when.year);
  const [created] = await db
    .insert(obEntries)
    .values({
      cpfId: auth.patroller.cpf_id,
      sectorId: sector.id,
      obNumber,
      sequence,
      year: norm.when.year,
      status: "active",
      category: norm.category,
      phase: norm.phase,
      dangerLevel: norm.dangerLevel,
      occurredAt: norm.when.occurredAt,
      timeOfDay: norm.when.timeOfDay,
      dayOfWeek: norm.when.dayOfWeek,
      suburbId: norm.suburbId,
      street: norm.street,
      lat: norm.lat,
      lng: norm.lng,
      description: norm.description,
      actionDetails: norm.actionDetails,
      receivedFrom: norm.receivedFrom,
      attendance: norm.attendance,
      capturedById: auth.patroller.patroller_id,
      callSign: auth.patroller.call_sign,
    })
    .returning();
  await replaceChildren(db, created!.id, norm);
  return created!;
}

ob.post("/entries", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<WriteBody>();
  const db = getDb(c.env);
  const norm = normalize(body, {});
  const sector = await resolveSector(db, auth, body.sector_id);
  await assertSuburb(db, auth.patroller.cpf_id, norm.suburbId);
  await assertResponders(db, auth, sector.id, norm.responderIds);
  await assertCompanies(db, auth.patroller.cpf_id, norm.services);
  const created = await insertEntry(c, db, auth, sector, norm);
  await logAudit(db, "ob.entry.created", auth, { ob_number: created.obNumber, entry_id: created.id });
  return c.json(await presentEntry(db, created), 201);
});

ob.patch("/entries/:id", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<WriteBody>();
  const db = getDb(c.env);
  const existing = await loadOwned(db, auth, c.req.param("id"));
  const currentTypes = await db.select().from(obEntryTypes).where(eq(obEntryTypes.entryId, existing.id));
  const isCommence = currentTypes.some((t) => t.typeKey === "commence_shift");
  const norm = normalize(body, { commenceShift: isCommence });
  await assertSuburb(db, auth.patroller.cpf_id, norm.suburbId);
  await assertResponders(db, auth, existing.sectorId, norm.responderIds);
  await assertCompanies(db, auth.patroller.cpf_id, norm.services);

  const [updated] = await db
    .update(obEntries)
    .set({
      category: norm.category,
      phase: norm.phase,
      dangerLevel: norm.dangerLevel,
      occurredAt: norm.when.occurredAt,
      timeOfDay: norm.when.timeOfDay,
      dayOfWeek: norm.when.dayOfWeek,
      suburbId: norm.suburbId,
      street: norm.street,
      lat: norm.lat,
      lng: norm.lng,
      description: norm.description,
      actionDetails: norm.actionDetails,
      receivedFrom: norm.receivedFrom,
      attendance: norm.attendance,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(obEntries.id, existing.id))
    .returning();

  await replaceChildren(db, existing.id, norm);
  await logAudit(db, "ob.entry.updated", auth, { ob_number: existing.obNumber, entry_id: existing.id });
  return c.json(await presentEntry(db, updated!));
});

ob.post("/entries/:id/close", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ conclusion?: string; action_details?: string }>();
  const conclusion = (body.conclusion ?? "").trim();
  if (!OB_CONCLUSIONS.includes(conclusion as (typeof OB_CONCLUSIONS)[number])) throw new AppError("OB_CONCLUSION_REQUIRED");
  const db = getDb(c.env);
  const existing = await loadOwned(db, auth, c.req.param("id"));
  const actionDetails = body.action_details != null ? body.action_details.trim() : existing.actionDetails;
  if (conclusion === "Other" && !actionDetails) throw new AppError("OB_INVALID_INPUT");

  const [updated] = await db
    .update(obEntries)
    .set({
      status: "closed",
      conclusion,
      actionDetails,
      closedAt: new Date().toISOString(),
      closedById: auth.patroller.patroller_id,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(obEntries.id, existing.id))
    .returning();

  if (conclusion === "Captured for Information Only") {
    const tags = await db.select().from(obEntryTags).where(eq(obEntryTags.entryId, existing.id));
    if (!tags.some((t) => t.tagKey === "information_only")) {
      await db.insert(obEntryTags).values({ entryId: existing.id, tagKey: "information_only" });
    }
  }

  await logAudit(db, "ob.entry.closed", auth, { ob_number: existing.obNumber, conclusion });
  return c.json(await presentEntry(db, updated!));
});

ob.post("/entries/:id/sightings", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ date?: string; time?: string; suburb_id?: string | null; street?: string; note?: string }>();
  const when = parseLocalWhen(body.date ?? "", body.time ?? "");
  if (!when) throw new AppError("OB_INVALID_INPUT");
  const db = getDb(c.env);
  const existing = await loadOwned(db, auth, c.req.param("id"));
  const suburbId = blank(body.suburb_id) || null;
  await assertSuburb(db, auth.patroller.cpf_id, suburbId);
  await db.insert(obSightings).values({
    entryId: existing.id,
    suburbId,
    street: (body.street ?? "").trim(),
    seenAt: when.occurredAt,
    note: blank(body.note) || null,
    reportedById: auth.patroller.patroller_id,
    callSign: auth.patroller.call_sign,
  });
  await logAudit(db, "ob.sighting.created", auth, { ob_number: existing.obNumber });
  const fresh = await loadOwned(db, auth, existing.id);
  return c.json(await presentEntry(db, fresh), 201);
});

ob.post("/commence-shift", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<WriteBody>().catch(() => ({}) as WriteBody);
  const clock = nowSast();
  const db = getDb(c.env);
  const norm = normalize({ ...body, date: body.date || clock.date, time: body.time || clock.time }, { commenceShift: true });
  const sector = await resolveSector(db, auth, body.sector_id);
  const created = await insertEntry(c, db, auth, sector, norm);
  await logAudit(db, "ob.commence_shift", auth, { ob_number: created.obNumber });
  return c.json(await presentEntry(db, created), 201);
});

ob.post("/suburbs", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ name?: string; aliases?: string[] }>();
  const name = blank(body.name);
  if (name.length < 2) throw new AppError("OB_INVALID_INPUT");
  const db = getDb(c.env);
  await ensureSuburbs(db, auth.patroller.cpf_id);
  const existing = await db.select().from(obSuburbs).where(eq(obSuburbs.cpfId, auth.patroller.cpf_id));
  const needle = name.toLowerCase();
  const clash = existing.find(
    (s) => s.name.toLowerCase() === needle || (s.aliases ?? []).some((a) => a.toLowerCase() === needle),
  );
  if (clash) throw new AppError("OB_SUBURB_DUPLICATE");
  const aliases = [...new Set((body.aliases ?? []).map((a) => a.trim()).filter(Boolean))];
  const [row] = await db
    .insert(obSuburbs)
    .values({ cpfId: auth.patroller.cpf_id, name, aliases, sortOrder: existing.length + 1 })
    .returning();
  await logAudit(db, "ob.suburb.created", auth, { name });
  return c.json({ id: row!.id, name: row!.name, aliases: row!.aliases ?? [] }, 201);
});

ob.post("/companies", async (c) => {
  const auth = getAuth(c);
  if (!canMaintainCompanies(auth)) throw new AppError("ACCESS_FORBIDDEN");
  const body = await c.req.json<{ name?: string }>();
  const name = blank(body.name);
  if (name.length < 2) throw new AppError("OB_INVALID_INPUT");
  const db = getDb(c.env);
  const existing = await db.select().from(obSecurityCompanies).where(eq(obSecurityCompanies.cpfId, auth.patroller.cpf_id));
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new AppError("OB_COMPANY_DUPLICATE");
  const [row] = await db.insert(obSecurityCompanies).values({ cpfId: auth.patroller.cpf_id, name }).returning();
  await logAudit(db, "ob.company.created", auth, { name });
  return c.json({ id: row!.id, name: row!.name }, 201);
});

export { ob as obBookRoutes };
