import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { adminFetch } from "../lib/api";
import { PageHeader } from "../components/DataTable";
import type { LiveMapPin } from "@patrol-log/shared";

// Leaflet's default icon path breaks with Vite bundling — fix it manually.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const activeIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const staleIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  className: "stale-marker",
});

// Pan the map when pins first load so we don't stay on the default view.
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
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 min ago";
  return `${diffMin} min ago`;
}

export function LiveMapPage() {
  const [pins, setPins] = useState<LiveMapPin[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function refresh() {
      try {
        const data = await adminFetch<{ pins: LiveMapPin[] }>("/admin/live-map");
        setPins(data.pins);
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

  const active = pins.filter((p) => !p.stale).length;
  const stale = pins.filter((p) => p.stale).length;

  return (
    <>
      <PageHeader title="Live Patroller Map" />

      {/* Status bar */}
      <div className="flex items-center gap-4 mb-4">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
          {active} active
        </span>
        {stale > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            {stale} stale (phone backgrounded / signal lost)
          </span>
        )}
        {lastRefresh && (
          <span className="ml-auto text-xs text-gray-400">
            Last updated {lastRefresh.toLocaleTimeString()} · auto-refreshes every 30s
          </span>
        )}
        {error && (
          <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">⚠ {error}</span>
        )}
      </div>

      {/* Map */}
      <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm" style={{ height: "calc(100vh - 200px)", minHeight: 480 }}>
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
          <AutoFit pins={pins} />
          {pins.map((p) => (
            <Marker
              key={p.patrol_id}
              position={[p.lat, p.lng]}
              icon={p.stale ? staleIcon : activeIcon}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{p.call_sign}</p>
                  <p className="text-gray-600 capitalize">{p.patrol_type.replace("_", " ")} patrol</p>
                  {p.patrol_vehicle && <p className="text-gray-600">Vehicle: {p.patrol_vehicle}</p>}
                  <p className="text-gray-600">{p.duration_on_patrol_min} min on patrol</p>
                  {p.speed != null && <p className="text-gray-500 text-xs">{Math.round(p.speed * 3.6)} km/h</p>}
                  <p className={`text-xs mt-1 font-medium ${p.stale ? "text-orange-500" : "text-green-600"}`}>
                    {p.stale ? "⚠ Stale — " : "✓ Live — "}
                    {formatAge(p.last_update)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex gap-6 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <img src="https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png" alt="" className="h-4 opacity-100" />
          Active (heartbeat &lt;2 min)
        </span>
        <span className="flex items-center gap-1.5 opacity-40">
          <img src="https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png" alt="" className="h-4" />
          Stale (heartbeat &gt;2 min)
        </span>
        <span className="ml-auto">Map data © OpenStreetMap contributors</span>
      </div>
    </>
  );
}
