// Admin-only: Sector CRUD with polygon boundary drawing on a Leaflet map.
// Uses leaflet-draw for polygon creation/editing.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// @ts-ignore
import "leaflet-draw/dist/leaflet.draw.css";
// @ts-ignore — leaflet-draw mutates the global L object; must be imported after leaflet
import "leaflet-draw";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import { Modal, Field, Btn, inputCls } from "../components/Modal";

// Fix Leaflet icon paths broken by Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Sector {
  id: string;
  name: string;
  boundaries: GeoJSONPolygon | null;
  createdAt: string;
}

type GeoJSONPolygon = { type: "Polygon"; coordinates: [number, number][][] };

// Colour palette for sector polygons
const SECTOR_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
];

// Component that attaches leaflet-draw controls to the map
function DrawControl({
  enabled,
  onPolygonDrawn,
}: {
  enabled: boolean;
  onPolygonDrawn: (poly: GeoJSONPolygon) => void;
}) {
  const map = useMap();
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const drawControlRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled) {
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
        drawControlRef.current = null;
      }
      if (drawnItemsRef.current) {
        map.removeLayer(drawnItemsRef.current);
        drawnItemsRef.current = null;
      }
      return;
    }

    const L_any = L as any;
    if (!L_any.Control?.Draw) return; // leaflet-draw not loaded yet

    const drawnItems = new L.FeatureGroup();
    drawnItems.addTo(map);
    drawnItemsRef.current = drawnItems;

    const drawControl = new L_any.Control.Draw({
      edit: { featureGroup: drawnItems, remove: false },
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: "#3B82F6", weight: 2 },
        },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
    });
    map.addControl(drawControl);
    drawControlRef.current = drawControl;

    function onCreated(e: any) {
      // Clear previous drawings
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      const geojson = e.layer.toGeoJSON();
      onPolygonDrawn(geojson.geometry as GeoJSONPolygon);
    }

    const L_Draw = (L_any as any).Draw;
    map.on(L_Draw?.Event?.CREATED ?? "draw:created", onCreated);

    return () => {
      map.off(L_Draw?.Event?.CREATED ?? "draw:created", onCreated);
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
        drawControlRef.current = null;
      }
      if (drawnItemsRef.current) {
        map.removeLayer(drawnItemsRef.current);
        drawnItemsRef.current = null;
      }
    };
  }, [enabled, map, onPolygonDrawn]);

  return null;
}

export function SectorsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Sector | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const [drawnPolygon, setDrawnPolygon] = useState<GeoJSONPolygon | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin.sectors"],
    queryFn: () => adminFetch<{ results: Sector[] }>("/admin/sectors"),
  });
  const sectors: Sector[] = data?.results ?? [];

  const create = useMutation({
    mutationFn: (body: { name: string; boundaries?: GeoJSONPolygon | null }) =>
      adminFetch<Sector>("/admin/sectors", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["admin.sectors"] });
      setAddOpen(false);
      setAddName("");
      setDrawnPolygon(null);
      setSelected(row);
    },
  });

  const update = useMutation({
    mutationFn: (body: { id: string; name?: string; boundaries?: GeoJSONPolygon | null }) =>
      adminFetch<Sector>(`/admin/sectors/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: body.name, boundaries: body.boundaries }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["admin.sectors"] });
      setEditOpen(false);
      setDrawMode(false);
      setDrawnPolygon(null);
      setSelected(row);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/sectors/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin.sectors"] });
      setSelected(null);
    },
    onError: (err: any) => {
      alert(err?.body?.message ?? "Could not delete sector. Ensure no members are assigned.");
    },
  });

  function openEdit(s: Sector) {
    setSelected(s);
    setEditName(s.name);
    setDrawnPolygon(null);
    setEditOpen(true);
  }

  function handlePolygonDrawn(poly: GeoJSONPolygon) {
    setDrawnPolygon(poly);
  }

  return (
    <div className="flex gap-0 h-full -m-6">
      {/* Left panel — sector list */}
      <aside className="w-80 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Sectors</h2>
          <Btn onClick={() => { setAddName(""); setDrawnPolygon(null); setAddOpen(true); }}>+ Add</Btn>
        </div>

        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Loading…</p>
        ) : sectors.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No sectors yet. Add one to get started.</p>
        ) : (
          <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {sectors.map((s, i) => (
              <li
                key={s.id}
                className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition ${selected?.id === s.id ? "bg-blue-50" : ""}`}
                onClick={() => setSelected(s)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
                  />
                  <span className="font-medium text-sm text-gray-900 flex-1">{s.name}</span>
                  {s.boundaries && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Boundary</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Selected sector actions */}
        {selected && (
          <div className="p-4 border-t border-gray-200 space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{selected.name}</p>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => openEdit(selected)}>
                Rename
              </Btn>
              <Btn
                variant="ghost"
                onClick={() => {
                  setDrawnPolygon(null);
                  setDrawMode(true);
                }}
              >
                Draw boundary
              </Btn>
            </div>
            {drawMode && (
              <div className="space-y-1">
                <p className="text-xs text-blue-600">Click the polygon tool on the map to draw. Double-click to finish.</p>
                {drawnPolygon && (
                  <Btn
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: selected.id, boundaries: drawnPolygon })}
                  >
                    {update.isPending ? "Saving…" : "Save boundary"}
                  </Btn>
                )}
                <Btn variant="ghost" onClick={() => { setDrawMode(false); setDrawnPolygon(null); }}>
                  Cancel draw
                </Btn>
              </div>
            )}
            <Btn
              variant="danger"
              onClick={() => {
                if (confirm(`Delete sector "${selected.name}"? All assigned members must be moved first.`)) {
                  remove.mutate(selected.id);
                }
              }}
            >
              Delete sector
            </Btn>
          </div>
        )}
      </aside>

      {/* Right panel — map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[-25.842, 28.178]}
          zoom={11}
          style={{ height: "100%", width: "100%" }}
          zoomControl
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
          />

          {/* Render all sector polygons */}
          {sectors.map((s, i) => {
            if (!s.boundaries) return null;
            const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
            const positions = s.boundaries.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]);
            return (
              <Polygon
                key={s.id}
                positions={positions}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: selected?.id === s.id ? 0.25 : 0.1,
                  weight: selected?.id === s.id ? 3 : 2,
                }}
                eventHandlers={{ click: () => setSelected(s) }}
              >
              </Polygon>
            );
          })}

          {/* Preview the newly drawn polygon (before save) */}
          {drawnPolygon && (
            <Polygon
              positions={drawnPolygon.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number])}
              pathOptions={{ color: "#3B82F6", fillColor: "#3B82F6", fillOpacity: 0.2, weight: 2, dashArray: "6 4" }}
            />
          )}

          <DrawControl enabled={drawMode} onPolygonDrawn={handlePolygonDrawn} />
        </MapContainer>

        {!drawMode && !selected && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow px-4 py-2 text-sm text-gray-500 pointer-events-none">
            Select a sector on the left to see or edit its boundary
          </div>
        )}
      </div>

      {/* Add modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add sector"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn
              disabled={create.isPending || !addName.trim()}
              onClick={() => create.mutate({ name: addName.trim() })}
            >
              {create.isPending ? "Creating…" : "Create sector"}
            </Btn>
          </>
        }
      >
        <Field label="Sector name" required>
          <input
            className={inputCls}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="e.g. North Sector"
            autoFocus
          />
        </Field>
        <p className="text-xs text-gray-500">You can draw the boundary polygon after creating the sector.</p>
      </Modal>

      {/* Rename modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Rename "${selected?.name}"`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Btn>
            <Btn
              disabled={update.isPending || !editName.trim()}
              onClick={() => update.mutate({ id: selected!.id, name: editName.trim() })}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Btn>
          </>
        }
      >
        <Field label="Sector name" required>
          <input
            className={inputCls}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
          />
        </Field>
      </Modal>
    </div>
  );
}
