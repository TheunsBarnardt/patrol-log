import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { adminFetch } from "../lib/api";
import { DataTable, PageHeader, RowActions } from "../components/DataTable";
import { Modal, Field, Btn, inputCls, selectCls } from "../components/Modal";

interface Hotspot {
  id: string;
  title: string;
  description: string;
  rating: number;
  diameterKm: number;
  lat: number;
  lng: number;
  sectorId: string;
  createdAt: string;
  updatedAt: string;
}

const EMPTY = {
  title: "",
  description: "",
  rating: 3,
  diameter_km: 0.5,
  lat: -25.842,
  lng: 28.178,
};

const RATINGS = [1, 2, 3, 4, 5] as const;

const pinIcon = L.divIcon({
  className: "hotspot-pick-pin",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#0f766e;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ratingLabel(r: number) {
  if (r >= 5) return "Critical";
  if (r >= 4) return "High";
  if (r >= 3) return "Medium";
  if (r >= 2) return "Low–med";
  return "Low";
}

function ratingColor(r: number): string {
  if (r >= 5) return "#DC2626";
  if (r >= 4) return "#F97316";
  if (r >= 3) return "#EAB308";
  if (r >= 2) return "#84CC16";
  return "#6B7280";
}

export function HotspotsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Hotspot | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.hotspots"],
    queryFn: () => adminFetch<{ results: Hotspot[] }>("/admin/hotspots"),
  });

  const create = useMutation({
    mutationFn: (body: typeof EMPTY) =>
      adminFetch<Hotspot>("/admin/hotspots", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin.hotspots"] });
      setAddOpen(false);
      setForm(EMPTY);
    },
  });
  const update = useMutation({
    mutationFn: (body: typeof EMPTY & { id: string }) =>
      adminFetch(`/admin/hotspots/${body.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin.hotspots"] });
      setEditRow(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/hotspots/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin.hotspots"] }),
  });

  const rows = (data?.results ?? []).filter(
    (r) =>
      !search ||
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()),
  );

  function openEdit(r: Hotspot) {
    setEditRow(r);
    setForm({
      title: r.title,
      description: r.description ?? "",
      rating: r.rating,
      diameter_km: r.diameterKm,
      lat: r.lat,
      lng: r.lng,
    });
  }

  return (
    <>
      <PageHeader
        title="Hotspots"
        search={search}
        onSearch={setSearch}
        action={<Btn onClick={() => { setForm(EMPTY); setAddOpen(true); }}>+ Add hotspot</Btn>}
      />

      <p className="mb-4 max-w-2xl text-sm text-gray-600">
        Mark risk areas for your sector with a rating (1–5), circle diameter in km, and a short description.
        Patrollers see these on the mobile hotspots map.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          keyExtractor={(r) => r.id}
          columns={[
            { header: "Title", render: (r) => <span className="font-medium">{r.title}</span> },
            {
              header: "Rating",
              render: (r) => (
                <span className="text-xs font-semibold">
                  {r.rating}/5 · {ratingLabel(r.rating)}
                </span>
              ),
            },
            {
              header: "Diameter",
              render: (r) => <span className="font-mono text-xs">{r.diameterKm} km</span>,
            },
            {
              header: "Location",
              render: (r) => (
                <span className="font-mono text-[11px] text-gray-500">
                  {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                </span>
              ),
            },
            {
              header: "Description",
              render: (r) => (
                <span className="line-clamp-2 max-w-xs text-xs text-gray-600">{r.description || "—"}</span>
              ),
            },
            {
              header: "",
              className: "text-right",
              render: (r) => (
                <RowActions
                  onEdit={() => openEdit(r)}
                  onDelete={() => {
                    if (confirm(`Remove hotspot "${r.title}"?`)) remove.mutate(r.id);
                  }}
                />
              ),
            },
          ]}
        />
      )}

      <HotspotFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add hotspot"
        form={form}
        onChange={setForm}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn disabled={create.isPending || !form.title.trim()} onClick={() => create.mutate(form)}>
              {create.isPending ? "Saving…" : "Add hotspot"}
            </Btn>
          </>
        }
        error={create.error instanceof Error ? create.error.message : null}
      />

      <HotspotFormModal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title={`Edit ${editRow?.title ?? ""}`}
        form={form}
        onChange={setForm}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn
              disabled={update.isPending || !form.title.trim()}
              onClick={() => update.mutate({ id: editRow!.id, ...form })}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Btn>
          </>
        }
        error={update.error instanceof Error ? update.error.message : null}
      />
    </>
  );
}

type MapMode = "move" | "place";

function HotspotFormModal({
  open,
  onClose,
  title,
  form,
  onChange,
  footer,
  error,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  form: typeof EMPTY;
  onChange: (f: typeof EMPTY) => void;
  footer: React.ReactNode;
  error: string | null;
}) {
  const [mapMode, setMapMode] = useState<MapMode>("move");
  const color = ratingColor(form.rating);
  const radiusM = Math.max(25, (Number(form.diameter_km) || 0.5) * 500);

  useEffect(() => {
    if (open) setMapMode("move");
  }, [open, title]);

  function setLatLng(lat: number, lng: number) {
    onChange({
      ...form,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl" footer={footer}>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-x-4">
        <div className="col-span-2">
          <Field label="Title" required>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
              placeholder="e.g. Park entrance"
            />
          </Field>
        </div>
        <Field label="Rating (1–5)" required>
          <select
            className={selectCls}
            value={form.rating}
            onChange={(e) => onChange({ ...form, rating: Number(e.target.value) })}
          >
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {r} — {ratingLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Diameter (km)" required>
          <input
            className={inputCls}
            type="number"
            min={0.05}
            max={50}
            step={0.05}
            value={form.diameter_km}
            onChange={(e) => onChange({ ...form, diameter_km: Number(e.target.value) })}
          />
        </Field>

        <div className="col-span-2 mb-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Location <span className="text-red-500">*</span>
          </label>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border bg-white p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setMapMode("move")}
                className={
                  mapMode === "move"
                    ? "rounded-md bg-brand-primary px-3 py-1.5 font-medium text-white"
                    : "rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                }
              >
                Move map
              </button>
              <button
                type="button"
                onClick={() => setMapMode("place")}
                className={
                  mapMode === "place"
                    ? "rounded-md bg-brand-primary px-3 py-1.5 font-medium text-white"
                    : "rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                }
              >
                Place pin
              </button>
            </div>
            <span className="text-xs text-gray-500">
              {mapMode === "move"
                ? "Drag with your hand to pan. Then switch to Place pin, or use Set pin at centre."
                : "Click the map to drop the hotspot pin."}
            </span>
          </div>
          <div
            className="relative overflow-hidden rounded-xl border border-gray-200"
            style={{ height: 300 }}
          >
            <style>{`
              .hotspot-pick-pin{background:transparent!important;border:0!important}
              .hotspot-map-move{cursor:grab!important}
              .hotspot-map-move:active{cursor:grabbing!important}
              .hotspot-map-place{cursor:crosshair!important}
            `}</style>
            {open && (
              <MapContainer
                key={title}
                center={[form.lat, form.lng]}
                zoom={14}
                className={mapMode === "move" ? "hotspot-map-move" : "hotspot-map-place"}
                style={{ height: "100%", width: "100%" }}
                zoomControl
                dragging={mapMode === "move"}
                doubleClickZoom={mapMode === "move"}
                scrollWheelZoom
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  subdomains="abc"
                  maxZoom={19}
                />
                <MapInteraction
                  mode={mapMode}
                  onPick={setLatLng}
                />
                <Marker position={[form.lat, form.lng]} icon={pinIcon} />
                <Circle
                  center={[form.lat, form.lng]}
                  radius={radiusM}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: 0.22,
                    weight: 1.5,
                    opacity: 0.7,
                  }}
                />
                <CenterPinButton
                  onSetCentre={(lat, lng) => {
                    setLatLng(lat, lng);
                    setMapMode("place");
                  }}
                />
              </MapContainer>
            )}
            {mapMode === "move" && (
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-1/2"
                aria-hidden
              >
                <div className="h-5 w-5 rounded-full border-2 border-brand-primary bg-white/80 shadow" />
              </div>
            )}
          </div>
        </div>

        <Field label="Latitude" required>
          <input
            className={inputCls}
            type="number"
            step="any"
            value={form.lat}
            onChange={(e) => onChange({ ...form, lat: Number(e.target.value) })}
          />
        </Field>
        <Field label="Longitude" required>
          <input
            className={inputCls}
            type="number"
            step="any"
            value={form.lng}
            onChange={(e) => onChange({ ...form, lng: Number(e.target.value) })}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Description">
            <textarea
              className={`${inputCls} min-h-[72px]`}
              value={form.description}
              onChange={(e) => onChange({ ...form, description: e.target.value })}
              placeholder="What to watch for, time of day, access notes…"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function MapInteraction({
  mode,
  onPick,
}: {
  mode: MapMode;
  onPick: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (mode !== "place") return;
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    if (mode === "move") map.dragging.enable();
    else map.dragging.disable();
  }, [mode, map]);

  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 80);
    const t2 = window.setTimeout(() => map.invalidateSize(), 300);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [map]);

  return null;
}

/** Drop pin at the current map centre after panning with the hand. */
function CenterPinButton({ onSetCentre }: { onSetCentre: (lat: number, lng: number) => void }) {
  const map = useMap();
  return (
    <div className="absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2">
      <button
        type="button"
        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-gray-800"
        onClick={() => {
          const c = map.getCenter();
          onSetCentre(c.lat, c.lng);
        }}
      >
        Set pin at centre
      </button>
    </div>
  );
}
