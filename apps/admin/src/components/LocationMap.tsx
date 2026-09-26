import { useEffect, useRef, useState, type FormEvent } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  OB_MAP_CENTER,
  obGeocodeHits,
  obGeocodeSearchUrl,
  type ObGeocodeHit,
} from "@patrol-log/shared";
import { adminFetch } from "../lib/api";
import { Btn, inputCls } from "./Modal";

function formatCoord(value: number): string {
  return (Math.round(value * 1e6) / 1e6).toFixed(6);
}

function parseCoord(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shortLabel(label: string): string {
  return label.split(",").slice(0, 3).map((part) => part.trim()).join(", ");
}

async function searchAddress(address: string, suburb: string): Promise<ObGeocodeHit[]> {
  const params = new URLSearchParams({ q: address });
  if (suburb) params.set("suburb", suburb);
  try {
    const data = await adminFetch<{ results: ObGeocodeHit[] }>(`/admin/ob/geocode?${params}`);
    if (Array.isArray(data?.results)) return data.results;
  } catch {
    // The desk API may not be updated yet, or the proxy may be down. Search directly.
  }
  const res = await fetch(obGeocodeSearchUrl(address, suburb), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address search is unavailable. Click the map, then drag it to place the pin.");
  return obGeocodeHits(await res.json());
}

function MapController({
  mountLat,
  mountLng,
  flight,
  placed,
  onMove,
}: {
  mountLat: number | null;
  mountLng: number | null;
  flight: { lat: number; lng: number; token: number } | null;
  placed: boolean;
  onMove: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const ignore = useRef(true);
  const lastFlight = useRef(0);
  const placedRef = useRef(placed);
  const onMoveRef = useRef(onMove);
  placedRef.current = placed;
  onMoveRef.current = onMove;

  useEffect(() => {
    const t1 = window.setTimeout(() => map.invalidateSize(), 60);
    const t2 = window.setTimeout(() => map.invalidateSize(), 280);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [map]);

  useEffect(() => {
    if (mountLat == null || mountLng == null) return;
    ignore.current = true;
    map.setView([mountLat, mountLng], 17);
    // Existing pin: centre once. Dragging the map afterwards is the fine-tune.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (!flight || flight.token === lastFlight.current) return;
    lastFlight.current = flight.token;
    ignore.current = true;
    map.flyTo([flight.lat, flight.lng], 17, { duration: 0.45 });
  }, [flight, map]);

  useMapEvents({
    moveend() {
      if (ignore.current) {
        ignore.current = false;
        return;
      }
      if (!placedRef.current) return;
      const center = map.getCenter();
      onMoveRef.current(center.lat, center.lng);
    },
    click(event) {
      ignore.current = true;
      map.panTo(event.latlng, { animate: true });
      onMoveRef.current(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

function CenterPin({ active }: { active: boolean }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
      <svg width="28" height="40" viewBox="0 0 28 40" aria-hidden>
        <path
          d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z"
          fill={active ? "#b91c1c" : "#6b7280"}
          stroke="#fff"
          strokeWidth="2"
        />
        <circle cx="14" cy="14" r="5" fill="#fff" />
      </svg>
    </div>
  );
}

export function LocationMap({
  lat,
  lng,
  street,
  suburbName,
  onChange,
}: {
  lat: string;
  lng: string;
  street: string;
  suburbName: string;
  onChange: (lat: string, lng: string) => void;
}) {
  const pinLat = parseCoord(lat);
  const pinLng = parseCoord(lng);
  const hasPin = pinLat != null && pinLng != null;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ObGeocodeHit[]>([]);
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [flight, setFlight] = useState<{ lat: number; lng: number; token: number } | null>(null);
  const mount = useRef({ lat: pinLat, lng: pinLng });

  function place(nextLat: number, nextLng: number, fly: boolean) {
    onChange(formatCoord(nextLat), formatCoord(nextLng));
    if (fly) setFlight({ lat: nextLat, lng: nextLng, token: Date.now() });
  }

  function choose(hit: ObGeocodeHit, index: number) {
    setPicked(index);
    setMessage("");
    place(hit.lat, hit.lng, true);
  }

  async function go(event: FormEvent) {
    event.preventDefault();
    const address = query.trim() || street.trim();
    if (address.length < 3) {
      setHits([]);
      setMessage("Enter an address to find on the map.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const results = await searchAddress(address, suburbName);
      setHits(results);
      setPicked(0);
      const first = results[0];
      if (!first) {
        setMessage("No matching address. Click the map to drop the pin, then drag the map to fine-tune it.");
        return;
      }
      place(first.lat, first.lng, true);
    } catch (err) {
      setHits([]);
      setMessage(err instanceof Error ? err.message : "Address search is unavailable. Click the map, then drag it to place the pin.");
    } finally {
      setBusy(false);
    }
  }

  const startLat = mount.current.lat ?? OB_MAP_CENTER.lat;
  const startLng = mount.current.lng ?? OB_MAP_CENTER.lng;

  return (
    <div>
      <form onSubmit={(event) => void go(event)} className="mb-2">
        <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ob-map-address">
          Address on the map
        </label>
        <div className="flex gap-2">
          <input
            id="ob-map-address"
            className={inputCls}
            value={query}
            placeholder={street.trim() ? "Leave blank to use the street above" : "e.g. 12 Jean Avenue"}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Btn type="submit" disabled={busy}>{busy ? "…" : "Go"}</Btn>
        </div>
      </form>
      {message && <p className="mb-2 text-sm text-gray-600">{message}</p>}
      {hits.length > 1 && (
        <ul className="mb-2 max-h-32 overflow-auto rounded-lg border border-gray-200 text-sm">
          {hits.map((hit, index) => (
            <li key={`${hit.lat},${hit.lng},${index}`}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left hover:bg-gray-50 ${index === picked ? "bg-gray-50 font-medium text-gray-900" : "text-gray-700"}`}
                title={hit.label}
                onClick={() => choose(hit, index)}
              >
                {shortLabel(hit.label)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative z-0 isolate h-72 overflow-hidden rounded-xl border border-gray-200 sm:h-80">
        <MapContainer
          center={[startLat, startLng]}
          zoom={hasPin ? 17 : 13}
          style={{ height: "100%", width: "100%", cursor: "grab" }}
          zoomControl
          scrollWheelZoom
          inertia={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            subdomains="abc"
            maxZoom={19}
          />
          <MapController
            mountLat={mount.current.lat}
            mountLng={mount.current.lng}
            flight={flight}
            placed={hasPin}
            onMove={(nextLat, nextLng) => place(nextLat, nextLng, false)}
          />
        </MapContainer>
        <CenterPin active={hasPin} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {hasPin
            ? "Drag the map to fine-tune the pin."
            : "Search for an address, or click the map to drop the pin."}
        </p>
        {hasPin && (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-800"
            onClick={() => {
              onChange("", "");
              setMessage("");
            }}
          >
            Clear pin
          </button>
        )}
      </div>
    </div>
  );
}
