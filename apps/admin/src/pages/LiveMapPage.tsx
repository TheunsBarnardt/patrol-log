import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import { parseSqliteUtc, type LiveMapMovement, type LiveMapPin, type PatrolType } from "@patrol-log/shared";

function movementOf(pin: LiveMapPin): LiveMapMovement {
  if (pin.patrol_type === "vehicle") return "car";
  if (
    pin.patrol_type === "static" ||
    pin.patrol_type === "sector_monitoring" ||
    pin.patrol_type === "ops" ||
    pin.patrol_type === "responding"
  ) {
    return "stationary";
  }
  return "walk";
}

function movementLabel(m: LiveMapMovement): string {
  if (m === "car") return "In vehicle";
  if (m === "walk") return "On foot";
  return "Stationary";
}

function pathColor(callSign: string): string {
  let h = 0;
  for (let i = 0; i < callSign.length; i++) h = (h << 5) - h + callSign.charCodeAt(i);
  return `hsl(${((h % 360) + 360) % 360} 70% 38%)`;
}

const MOVING_MS = 0.8; // m/s — below this, don't rotate heading

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Uber-style glyph + always-on call sign (and plate for cars). */
function makePinIcon(pin: LiveMapPin): L.DivIcon {
  const movement = movementOf(pin);
  const stale = pin.stale;
  const moving = pin.speed != null && pin.speed >= MOVING_MS;
  const heading =
    movement === "car" && moving && pin.heading != null && Number.isFinite(pin.heading)
      ? pin.heading
      : 0;

  const fill = stale ? "#9CA3AF" : movement === "car" ? "#2563EB" : movement === "walk" ? "#059669" : "#D97706";
  const ring = stale ? "#6B7280" : "#fff";

  const glyph =
    movement === "car"
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;transform:rotate(${heading}deg)">
          <path fill="${ring}" d="M5 11.5 6.2 7.8A2 2 0 0 1 8.1 6.5h7.8a2 2 0 0 1 1.9 1.3L19 11.5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-.5H8V16.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-5Z"/>
          <circle cx="7.5" cy="15" r="1.4" fill="${fill}"/>
          <circle cx="16.5" cy="15" r="1.4" fill="${fill}"/>
          <path fill="${fill}" d="M7.2 8h9.6l1.1 3.2H6.1L7.2 8Z"/>
        </svg>`
      : movement === "walk"
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="${ring}" xmlns="http://www.w3.org/2000/svg" style="display:block">
            <circle cx="13.5" cy="4.5" r="2.2"/>
            <path d="M10.2 8.2c.7-.5 1.7-.6 2.6-.2l2.2 1.1 2.1-.7.7 1.9-2.8.9-1.5-.7-.8 2.2 2.4 1.6-.9 1.7-3.1-2.1c-.7-.5-1-1.4-.7-2.2l1-3.5-1.4-.9Z"/>
            <path d="M9.2 20.5 11 14.8l2.2 1.5 1.8 4.2-2 .9-1.2-2.8-1.1.7-.7 1.2Z"/>
          </svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="${ring}" xmlns="http://www.w3.org/2000/svg" style="display:block">
            <circle cx="12" cy="6" r="2.4"/>
            <path d="M8.5 10.2c0-1.2 1.5-2.2 3.5-2.2s3.5 1 3.5 2.2V14h-1.6v7.2h-3.8V14H8.5v-3.8Z"/>
          </svg>`;

  const sub =
    movement === "car" && pin.vehicle_registration
      ? escapeHtml(pin.vehicle_registration)
      : movementLabel(movement);

  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;opacity:${stale ? 0.55 : 1}">
      <div style="
        width:40px;height:40px;border-radius:9999px;background:${fill};
        border:3px solid ${ring};box-shadow:0 2px 8px rgba(0,0,0,.35);
        display:flex;align-items:center;justify-content:center;
      ">${glyph}</div>
      <div style="
        margin-top:1px;padding:2px 7px;border-radius:9999px;background:rgba(17,24,39,.92);
        color:#fff;font:700 11px/1.2 system-ui,sans-serif;white-space:nowrap;
        box-shadow:0 1px 4px rgba(0,0,0,.35);max-width:120px;overflow:hidden;text-overflow:ellipsis;
      ">${escapeHtml(pin.call_sign)}</div>
      <div style="
        padding:1px 6px;border-radius:9999px;background:rgba(255,255,255,.92);
        color:#374151;font:600 10px/1.2 system-ui,sans-serif;white-space:nowrap;
        box-shadow:0 1px 3px rgba(0,0,0,.2);max-width:120px;overflow:hidden;text-overflow:ellipsis;
      ">${sub}</div>
    </div>`;

  return L.divIcon({
    className: "live-pin",
    html,
    iconSize: [40, 68],
    iconAnchor: [20, 20],
    popupAnchor: [0, -28],
  });
}

function AutoFit({ pins }: { pins: LiveMapPin[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (pins.length > 0 && !fitted.current) {
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    }
  }, [pins, map]);

  return null;
}

function formatAge(isoString: string): string {
  const at = parseSqliteUtc(isoString)?.getTime() ?? new Date(isoString).getTime();
  const diffMs = Date.now() - at;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 min ago";
  return `${diffMin} min ago`;
}

function typeCaption(type: PatrolType): string {
  if (type === "vehicle") return "Vehicle patrol";
  if (type === "static") return "Static post";
  if (type === "sector_monitoring") return "Sector monitoring";
  if (type === "ops") return "OPS";
  if (type === "responding") return "Responding";
  return "Foot patrol";
}

export function LiveMapPage() {
  const [pins, setPins] = useState<LiveMapPin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileVisible, setMobileVisible] = useState(true);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const savingVisibilityRef = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function refresh() {
      try {
        const data = await adminFetch<{ pins: LiveMapPin[]; mobile_live_map_enabled?: boolean }>("/admin/live-map");
        setPins(data.pins);
        if (typeof data.mobile_live_map_enabled === "boolean" && !savingVisibilityRef.current) {
          setMobileVisible(data.mobile_live_map_enabled);
        }
        setLastRefresh(new Date());
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setError(msg);
      }
    }
    void refresh();
    timer.current = setInterval(refresh, 30_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function toggleMobileVisible(next: boolean) {
    const prev = mobileVisible;
    setMobileVisible(next);
    savingVisibilityRef.current = true;
    setSavingVisibility(true);
    try {
      await adminFetch<{ mobile_live_map_enabled: boolean }>("/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ mobile_live_map_enabled: next }),
      });
    } catch (err) {
      setMobileVisible(prev);
      const msg = err instanceof Error ? err.message : "Could not save";
      setError(msg);
    } finally {
      savingVisibilityRef.current = false;
      setSavingVisibility(false);
    }
  }

  const icons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    for (const p of pins) map.set(p.patrol_id, makePinIcon(p));
    return map;
  }, [pins]);

  const active = pins.filter((p) => !p.stale).length;
  const stale = pins.filter((p) => p.stale).length;
  const cars = pins.filter((p) => movementOf(p) === "car").length;
  const walks = pins.filter((p) => movementOf(p) === "walk").length;
  const stationary = pins.filter((p) => movementOf(p) === "stationary").length;

  return (
    <>
      <PageHeader title="Live Patroller Map" />

      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-blue-700"
          checked={mobileVisible}
          disabled={savingVisibility}
          onChange={(e) => void toggleMobileVisible(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-gray-800">Show live locations on mobile</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            {mobileVisible
              ? "Patrollers can see each other on the app live map. This admin map always stays on."
              : "Mobile app hides other patrollers. GPS still updates on this admin map."}
          </span>
        </span>
      </label>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
          {active} live
        </span>
        {stale > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-400">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
            {stale} stale
          </span>
        )}
        <span className="text-sm text-gray-500">
          {cars} car · {walks} walk · {stationary} stationary
        </span>
        <span className="text-sm text-gray-500">Click a pin to highlight that patrol’s route</span>
        {lastRefresh && (
          <span className="ml-auto text-xs text-gray-400">
            Last updated {lastRefresh.toLocaleTimeString()} · every 30s
          </span>
        )}
        {error && (
          <span className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">⚠ {error}</span>
        )}
      </div>

      <div
        className="overflow-hidden rounded-lg border border-gray-200 shadow-sm"
        style={{ height: "calc(100vh - 200px)", minHeight: 480 }}
      >
        <style>{`.live-pin{background:transparent!important;border:0!important}`}</style>
        <MapContainer
          center={[-25.842, 28.178]}
          zoom={11}
          style={{ height: "100%", width: "100%" }}
          zoomControl
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            subdomains="abc"
            maxZoom={19}
          />
          <AutoFit pins={pins} />
          {pins.map((p) => {
            const path = p.path;
            if (!path || path.length < 2) return null;
            const on = selectedId === p.patrol_id;
            return (
              <Polyline
                key={`path-${p.patrol_id}`}
                positions={path}
                pathOptions={{
                  color: pathColor(p.call_sign),
                  weight: on ? 7 : 4,
                  opacity: on ? 0.95 : 0.42,
                }}
                eventHandlers={{
                  click: () => setSelectedId((cur) => (cur === p.patrol_id ? null : p.patrol_id)),
                }}
              />
            );
          })}
          {pins.map((p) => (
            <Marker
              key={p.patrol_id}
              position={[p.lat, p.lng]}
              icon={icons.get(p.patrol_id)}
              eventHandlers={{
                click: () => setSelectedId((cur) => (cur === p.patrol_id ? null : p.patrol_id)),
              }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="mb-1 text-base font-bold">{p.call_sign}</p>
                  <p className="font-medium text-gray-800">{movementLabel(movementOf(p))}</p>
                  <p className="text-gray-600">{typeCaption(p.patrol_type)}</p>
                  {p.vehicle_registration && (
                    <p className="text-gray-600">Vehicle: {p.vehicle_registration}</p>
                  )}
                  <p className="text-gray-600">{p.duration_on_patrol_min} min on patrol</p>
                  {p.path_km != null && p.path_km > 0 && (
                    <p className="text-gray-600">{p.path_km} km covered</p>
                  )}
                  {p.speed != null && (
                    <p className="text-xs text-gray-500">{Math.round(p.speed * 3.6)} km/h</p>
                  )}
                  <p
                    className={`mt-1 text-xs font-medium ${p.stale ? "text-orange-500" : "text-green-600"}`}
                  >
                    {p.stale ? "⚠ Stale — " : "✓ Live — "}
                    {formatAge(p.last_update)}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">Click pin to highlight route</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-5 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-blue-600" /> Car
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-emerald-600" /> Walk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-amber-600" /> Stationary
        </span>
        <span className="inline-flex items-center gap-1.5 opacity-50">
          <span className="inline-block h-3 w-3 rounded-full bg-gray-400" /> Stale (&gt;2 min)
        </span>
        <span className="ml-auto">Map data © OpenStreetMap contributors</span>
      </div>
    </>
  );
}
