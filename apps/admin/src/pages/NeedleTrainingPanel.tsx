import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OB_CATEGORIES,
  OB_TYPES,
  OB_VOI_COLOURS,
  OB_VOI_SHAPES,
  OB_POI_GENDERS,
  OB_ETHNICITIES,
  splitTrainingPassages,
  type ObCategory,
} from "@patrol-log/shared";
import { adminFetch, authStore } from "../lib/api";
import { extractIncident, type NeedleFill } from "../lib/needle";
import { Btn, Field, inputCls, selectCls } from "../components/Modal";

interface Suburb { id: string; name: string; aliases: string[] }
interface Member { id: string; callSign: string; name: string; phone: string | null }
interface Resident { id: string; name: string; phone: string }
interface ExampleRow {
  id: string;
  passage: string;
  vote: "up" | "down";
  notes: string;
  source?: "live" | "history";
  fieldScore?: number | null;
  needleFill?: Partial<NeedleFill>;
  correctedFill?: Partial<NeedleFill> | null;
  createdAt: string;
}
interface Meta {
  suburbs: Suburb[];
  members: Member[];
  residents: Resident[];
  needleExamples: ExampleRow[];
}

interface CorpusItem {
  id: string;
  passage: string;
  label: string;
  status: "pending" | "done" | "skipped";
  createdAt: string;
}

interface Stats {
  totals: {
    up: number;
    down: number;
    live: number;
    history: number;
    avgScore: number | null;
    goodRate: number | null;
    pending: number;
    done: number;
    skipped: number;
  };
  weekly: {
    week: string;
    up: number;
    down: number;
    count: number;
    avgScore: number | null;
    goodRate: number | null;
  }[];
}

type Corrected = {
  incidentKey: string;
  category: ObCategory;
  phase: "" | "alpha" | "bravo";
  suburbId: string;
  street: string;
  date: string;
  time: string;
  colour: string;
  shape: string;
  make: string;
  model: string;
  personName: string;
  personGender: string;
  personEthnicity: string;
  personClothing: string;
  contactName: string;
  contactPhone: string;
  description: string;
};

function emptyCorrected(): Corrected {
  return {
    incidentKey: "",
    category: "criminal",
    phase: "",
    suburbId: "",
    street: "",
    date: "",
    time: "",
    colour: "",
    shape: "",
    make: "",
    model: "",
    personName: "",
    personGender: "",
    personEthnicity: "",
    personClothing: "",
    contactName: "",
    contactPhone: "",
    description: "",
  };
}

function fromFill(fill: NeedleFill): Corrected {
  const type = fill.incidentKey ? OB_TYPES.find((t) => t.key === fill.incidentKey) : undefined;
  const person = fill.persons[0] ?? fill.person;
  return {
    incidentKey: fill.incidentKey ?? "",
    category: type?.category ?? "criminal",
    phase: fill.phase || "",
    suburbId: fill.suburbId ?? "",
    street: fill.street,
    date: fill.date,
    time: fill.time,
    colour: fill.vehicle?.colour ?? "",
    shape: fill.vehicle?.shape ?? "",
    make: fill.vehicle?.make ?? "",
    model: fill.vehicle?.model ?? "",
    personName: person?.name ?? "",
    personGender: person?.gender ?? "",
    personEthnicity: person?.ethnicity ?? "",
    personClothing: person?.clothing ?? "",
    contactName: fill.contactName,
    contactPhone: fill.contactPhone,
    description: fill.description,
  };
}

function toCorrectedFill(form: Corrected): Partial<NeedleFill> {
  const persons = form.personName || form.personGender || form.personEthnicity || form.personClothing
    ? [{
        name: form.personName,
        gender: form.personGender,
        ethnicity: form.personEthnicity,
        clothing: form.personClothing,
        direction: "",
      }]
    : [];
  return {
    incidentKey: form.incidentKey || null,
    tagKeys: [],
    phase: form.phase,
    suburbId: form.suburbId || null,
    street: form.street,
    date: form.date,
    time: form.time,
    description: form.description,
    attendance: "",
    vehicle: form.colour || form.make || form.shape || form.model
      ? { colour: form.colour, make: form.make, model: form.model, registration: "", shape: form.shape }
      : null,
    persons,
    person: persons[0] ?? null,
    contactName: form.contactName,
    contactPhone: form.contactPhone,
  };
}

function ImprovementGraph({ weekly }: { weekly: Stats["weekly"] }) {
  const points = weekly.filter((w) => w.goodRate != null || w.avgScore != null);
  if (points.length < 2) {
    return (
      <p className="px-5 py-8 text-sm text-gray-500">
        Rate a few fills (live or history) to see the improvement trend.
      </p>
    );
  }
  const width = 640;
  const height = 200;
  const pad = 28;
  const xs = points.map((_, i) => pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1));
  const goodLine = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]},${height - pad - ((p.goodRate ?? 0) / 100) * (height - pad * 2)}`);
  const scoreLine = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]},${height - pad - ((p.avgScore ?? 0) / 100) * (height - pad * 2)}`);
  return (
    <div className="overflow-x-auto px-3 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full min-w-[28rem]" role="img" aria-label="Needle training improvement">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = height - pad - (tick / 100) * (height - pad * 2);
          return (
            <g key={tick}>
              <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="#e5e7eb" />
              <text x={8} y={y + 4} className="fill-gray-400" fontSize="10">{tick}</text>
            </g>
          );
        })}
        <path d={goodLine.join(" ")} fill="none" stroke="#166534" strokeWidth="2.5" />
        <path d={scoreLine.join(" ")} fill="none" stroke="#1d4ed8" strokeWidth="2" strokeDasharray="5 4" />
        {points.map((p, i) => (
          <text key={p.week} x={xs[i]} y={height - 8} textAnchor="middle" className="fill-gray-500" fontSize="9">
            {p.week?.slice(-2)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex gap-4 px-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-green-800" /> Good rate %</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-blue-700" /> Field match %</span>
      </div>
    </div>
  );
}

export function NeedleTrainingPanel() {
  const qc = useQueryClient();
  const profile = authStore.getProfile();
  const canHistory = profile?.access_level === "admin" || profile?.access_level === "system_admin";

  const [importText, setImportText] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState<CorpusItem | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [done, setDone] = useState(0);
  const [needleFill, setNeedleFill] = useState<NeedleFill | null>(null);
  const [corrected, setCorrected] = useState<Corrected>(emptyCorrected);
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);

  const meta = useQuery({
    queryKey: ["admin.ob.meta"],
    queryFn: () => adminFetch<Meta>("/admin/ob/meta"),
  });
  const stats = useQuery({
    queryKey: ["admin.ob.needle-stats"],
    queryFn: () => adminFetch<Stats>("/admin/ob/needle-stats"),
  });
  const examples = useQuery({
    queryKey: ["admin.ob.needle-examples"],
    queryFn: () => adminFetch<{ results: ExampleRow[] }>("/admin/ob/needle-examples"),
  });

  const previewCount = useMemo(() => splitTrainingPassages(importText).length, [importText]);
  const types = OB_TYPES.filter((t) => t.category === corrected.category);

  async function refreshNext() {
    if (!canHistory) return;
    try {
      const next = await adminFetch<{ item: CorpusItem; remaining: number; done: number }>("/admin/ob/needle-corpus/next");
      setItem(next.item);
      setRemaining(next.remaining);
      setDone(next.done);
      setNeedleFill(null);
      setCorrected(emptyCorrected());
      setNotes("");
      setError("");
    } catch (e) {
      setItem(null);
      setNeedleFill(null);
      const message = e instanceof Error ? e.message : "No pending history left.";
      if (!/no pending|could not|empty/i.test(message)) setError(message);
      try {
        const list = await adminFetch<{ counts: { pending: number; done: number } }>("/admin/ob/needle-corpus");
        setRemaining(list.counts.pending);
        setDone(list.counts.done);
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    void refreshNext();
  }, [canHistory]);

  async function importHistory() {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch<{ imported: number }>("/admin/ob/needle-corpus/import", {
        method: "POST",
        body: JSON.stringify({ text: importText, label: importLabel }),
      });
      setImportText("");
      await refreshNext();
      await qc.invalidateQueries({ queryKey: ["admin.ob.needle-stats"] });
      setError(`Imported ${res.imported} historical message${res.imported === 1 ? "" : "s"} for training only.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import history");
    } finally {
      setBusy(false);
    }
  }

  async function runNeedle() {
    if (!item) return;
    setRunning(true);
    setError("");
    try {
      const directory = [
        ...(meta.data?.residents ?? []).map((row) => ({ id: row.id, name: row.name, phone: row.phone, kind: "resident" as const })),
        ...(meta.data?.members ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          callSign: row.callSign,
          kind: "member" as const,
        })),
      ];
      const trained = (examples.data?.results ?? meta.data?.needleExamples ?? [])
        .filter((row) => row.vote === "up")
        .slice(0, 8)
        .map((row) => ({
          passage: row.passage,
          corrected: (row.correctedFill ?? row.needleFill ?? {}) as Partial<NeedleFill>,
        }));
      const fill = await extractIncident(
        [{ groupName: "History", body: item.passage }],
        meta.data?.suburbs ?? [],
        { directory, examples: trained },
      );
      setNeedleFill(fill);
      setCorrected(fromFill(fill));
      if (fill.warning) setError(fill.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Needle could not read this message");
    } finally {
      setRunning(false);
    }
  }

  async function review(vote: "up" | "down") {
    if (!item || !needleFill) return;
    setBusy(true);
    setError("");
    try {
      await adminFetch(`/admin/ob/needle-corpus/${item.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          needle_fill: needleFill,
          corrected_fill: toCorrectedFill(corrected),
          vote,
          notes,
        }),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin.ob.needle-examples"] }),
        qc.invalidateQueries({ queryKey: ["admin.ob.needle-stats"] }),
        qc.invalidateQueries({ queryKey: ["admin.ob.meta"] }),
      ]);
      await refreshNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the training vote");
    } finally {
      setBusy(false);
    }
  }

  async function skipItem() {
    if (!item) return;
    setBusy(true);
    try {
      await adminFetch(`/admin/ob/needle-corpus/${item.id}/skip`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["admin.ob.needle-stats"] });
      await refreshNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not skip");
    } finally {
      setBusy(false);
    }
  }

  async function removeExample(id: string) {
    try {
      await adminFetch(`/admin/ob/needle-examples/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["admin.ob.needle-examples"] });
      await qc.invalidateQueries({ queryKey: ["admin.ob.meta"] });
      await qc.invalidateQueries({ queryKey: ["admin.ob.needle-stats"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that example");
    }
  }

  const totals = stats.data?.totals;
  const trainingRows = examples.data?.results ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${error.startsWith("Imported") ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-800"}`}>
          {error}
        </p>
      )}

      <section className="rounded-lg border border-black/10 bg-white shadow-sm">
        <div className="border-b border-black/5 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Improvement</h2>
          <p className="mt-1 text-sm text-gray-600">
            Live OB thumbs and historical training both feed this chart. Good rate is thumbs; field match compares Needle to your corrections.
          </p>
        </div>
        <div className="grid gap-3 border-b border-black/5 px-5 py-4 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Good rate</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{totals?.goodRate == null ? "—" : `${totals.goodRate}%`}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Field match</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{totals?.avgScore == null ? "—" : `${totals.avgScore}%`}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Live / history</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{totals ? `${totals.live} / ${totals.history}` : "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">History queue</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{totals ? `${totals.done} done · ${totals.pending} left` : "—"}</p>
          </div>
        </div>
        <ImprovementGraph weekly={stats.data?.weekly ?? []} />
      </section>

      {canHistory ? (
        <>
          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Import historical messages</h2>
            <p className="mt-1 text-sm text-gray-600">
              Paste old incident reports only. Separate incidents with a blank line or a line of ---. This never creates occurrence book entries.
            </p>
            <div className="mt-4 grid gap-3">
              <Field label="Batch label (optional)">
                <input className={inputCls} placeholder="e.g. 2019–2024 WhatsApp export" value={importLabel} onChange={(e) => setImportLabel(e.target.value)} />
              </Field>
              <Field label="Messages">
                <textarea
                  className={inputCls}
                  rows={8}
                  placeholder={"Clubview\nNo 2 Ceder Avenue...\n\n---\n\nNext incident..."}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">{previewCount ? `${previewCount} message${previewCount === 1 ? "" : "s"} ready` : "Paste at least one message"}</p>
                <Btn onClick={() => void importHistory()} disabled={busy || previewCount === 0}>
                  {busy ? "Importing…" : "Import for training"}
                </Btn>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Train one by one</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Run Needle, fix only what is wrong, then vote. {done} reviewed · {remaining} remaining.
                </p>
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => void refreshNext()} disabled={busy}>Refresh</Btn>
                {item && <Btn variant="ghost" onClick={() => void skipItem()} disabled={busy}>Skip</Btn>}
              </div>
            </div>

            {!item && (
              <p className="mt-4 text-sm text-gray-500">No pending historical messages. Import a batch above to start.</p>
            )}

            {item && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg bg-gray-50 px-3 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Source message</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{item.passage}</p>
                </div>
                <div className="flex justify-end">
                  <Btn onClick={() => void runNeedle()} disabled={running}>
                    {running ? "Reading…" : needleFill ? "Run Needle again" : "Run Needle"}
                  </Btn>
                </div>

                {needleFill && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Category">
                      <select
                        className={selectCls}
                        value={corrected.category}
                        onChange={(e) => setCorrected({ ...corrected, category: e.target.value as ObCategory, incidentKey: "" })}
                      >
                        {OB_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Incident type">
                      <select className={selectCls} value={corrected.incidentKey} onChange={(e) => setCorrected({ ...corrected, incidentKey: e.target.value })}>
                        <option value="">Choose type</option>
                        {types.map((t) => <option key={t.key} value={t.key}>{t.name}{t.code ? ` (${t.code})` : ""}</option>)}
                      </select>
                    </Field>
                    {corrected.category === "criminal" && (
                      <Field label="Phase">
                        <select className={selectCls} value={corrected.phase} onChange={(e) => setCorrected({ ...corrected, phase: e.target.value as Corrected["phase"] })}>
                          <option value="">Unknown</option>
                          <option value="alpha">Alpha</option>
                          <option value="bravo">Bravo</option>
                        </select>
                      </Field>
                    )}
                    <Field label="Suburb">
                      <select className={selectCls} value={corrected.suburbId} onChange={(e) => setCorrected({ ...corrected, suburbId: e.target.value })}>
                        <option value="">Choose suburb</option>
                        {(meta.data?.suburbs ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Street / complex"><input className={inputCls} value={corrected.street} onChange={(e) => setCorrected({ ...corrected, street: e.target.value })} /></Field>
                    <Field label="Date"><input className={inputCls} type="date" value={corrected.date} onChange={(e) => setCorrected({ ...corrected, date: e.target.value })} /></Field>
                    <Field label="Time"><input className={inputCls} type="time" value={corrected.time} onChange={(e) => setCorrected({ ...corrected, time: e.target.value })} /></Field>
                    <Field label="Vehicle colour">
                      <select className={selectCls} value={corrected.colour} onChange={(e) => setCorrected({ ...corrected, colour: e.target.value })}>
                        <option value="">—</option>
                        {OB_VOI_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Vehicle shape">
                      <select className={selectCls} value={corrected.shape} onChange={(e) => setCorrected({ ...corrected, shape: e.target.value })}>
                        <option value="">—</option>
                        {OB_VOI_SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                    <Field label="Make"><input className={inputCls} value={corrected.make} onChange={(e) => setCorrected({ ...corrected, make: e.target.value })} /></Field>
                    <Field label="Model"><input className={inputCls} value={corrected.model} onChange={(e) => setCorrected({ ...corrected, model: e.target.value })} /></Field>
                    <Field label="Person name"><input className={inputCls} value={corrected.personName} onChange={(e) => setCorrected({ ...corrected, personName: e.target.value })} /></Field>
                    <Field label="Person gender">
                      <select className={selectCls} value={corrected.personGender} onChange={(e) => setCorrected({ ...corrected, personGender: e.target.value })}>
                        <option value="">—</option>
                        {OB_POI_GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </Field>
                    <Field label="Ethnicity">
                      <select className={selectCls} value={corrected.personEthnicity} onChange={(e) => setCorrected({ ...corrected, personEthnicity: e.target.value })}>
                        <option value="">—</option>
                        {OB_ETHNICITIES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </Field>
                    <Field label="Clothing"><input className={inputCls} value={corrected.personClothing} onChange={(e) => setCorrected({ ...corrected, personClothing: e.target.value })} /></Field>
                    <Field label="Contact name"><input className={inputCls} value={corrected.contactName} onChange={(e) => setCorrected({ ...corrected, contactName: e.target.value })} /></Field>
                    <Field label="Contact phone"><input className={inputCls} value={corrected.contactPhone} onChange={(e) => setCorrected({ ...corrected, contactPhone: e.target.value })} /></Field>
                    <div className="sm:col-span-2">
                      <Field label="Note (optional)">
                        <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What Needle got wrong" />
                      </Field>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review("up")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-sm font-medium hover:bg-green-50 disabled:opacity-40"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M7 11v9H4v-9h3zm3 9h7.2a2 2 0 0 0 1.95-1.55l1.3-5.2A1.8 1.8 0 0 0 18.7 11H14V7.2A2.2 2.2 0 0 0 11.8 5L10 11v9z" />
                        </svg>
                        Good
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review("down")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-40"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M17 13V4h3v9h-3zm-3-9H6.8a2 2 0 0 0-1.95 1.55l-1.3 5.2A1.8 1.8 0 0 0 5.3 13H10v3.8A2.2 2.2 0 0 0 12.2 19L14 13V4z" />
                        </svg>
                        Fix needed
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Historical training</h2>
          <p className="mt-1 text-sm text-gray-600">Only an admin can import the five-year history and train one by one. Live OB thumbs still work for the desk.</p>
        </section>
      )}

      <section className="flex min-h-48 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
        <h2 className="border-b border-black/5 px-5 py-4 text-base font-semibold text-gray-900">Saved examples</h2>
        {examples.isLoading && <p className="px-5 py-4 text-sm text-gray-500">Loading…</p>}
        {!examples.isLoading && trainingRows.length === 0 && (
          <p className="px-5 py-4 text-sm text-gray-500">No votes yet. Use live OB thumbs or the history trainer above.</p>
        )}
        <ul className="min-h-0 flex-1 overflow-auto">
          {trainingRows.map((row) => (
            <li key={row.id} className="border-t border-black/5 px-5 py-3 first:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {row.vote === "up" ? "Good" : "Correction"} · {row.source === "history" ? "History" : "Live"}
                    {row.fieldScore != null ? ` · ${row.fieldScore}% fields` : ""} · {row.createdAt}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{row.passage.slice(0, 400)}{row.passage.length > 400 ? "…" : ""}</p>
                  {row.notes && <p className="mt-1 text-xs text-gray-500">{row.notes}</p>}
                </div>
                <button type="button" className="shrink-0 text-sm text-red-700 hover:underline" onClick={() => void removeExample(row.id)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
