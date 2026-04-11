/**
 * LeafletMapView — embeds a Leaflet/OpenStreetMap map inside a WebView.
 * No Google Maps API key required. Communicates with the native layer via
 * injectedJavaScript so pins can be updated without reloading the WebView.
 *
 * Tile caching: cacheMode="LOAD_CACHE_ELSE_NETWORK" (Android) tells the WebView
 * to serve OSM tiles from the on-device HTTP disk cache whenever available,
 * only fetching from the network on a cache miss. OSM tile servers already send
 * proper Cache-Control / max-age headers (typically 1–7 days), so tiles that
 * have been displayed before load instantly and work partially offline.
 */

import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import WebView from "react-native-webview";

export interface LeafletPin {
  id: string;
  lat: number;
  lng: number;
  color: string;   // CSS colour string
  title: string;
  body: string;
}

interface Props {
  pins: LeafletPin[];
  defaultCenter?: [number, number];
  defaultZoom?: number;
  style?: object;
}

/** Returns the full HTML page loaded once into the WebView. */
function buildHtml(defaultCenter: [number, number], defaultZoom: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html, body, #map { margin:0; padding:0; width:100%; height:100%; background:#e8e0d8; }
  .custom-dot { width:16px; height:16px; border-radius:50%; border:3px solid #fff;
    box-shadow:0 1px 4px rgba(0,0,0,.4); }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map', { zoomControl: true }).setView(${JSON.stringify(defaultCenter)}, ${defaultZoom});

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  var markers = {};

  function makeIcon(color) {
    return L.divIcon({
      className: '',
      html: '<div class="custom-dot" style="background:' + color + '"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -10]
    });
  }

  window.updatePins = function(pinsJson) {
    var pins = JSON.parse(pinsJson);
    var seen = {};

    pins.forEach(function(p) {
      seen[p.id] = true;
      if (markers[p.id]) {
        markers[p.id].setLatLng([p.lat, p.lng]);
        markers[p.id].setIcon(makeIcon(p.color));
        markers[p.id].getPopup().setContent('<b>' + p.title + '</b><br>' + p.body);
      } else {
        var m = L.marker([p.lat, p.lng], { icon: makeIcon(p.color) })
          .bindPopup('<b>' + p.title + '</b><br>' + p.body)
          .addTo(map);
        markers[p.id] = m;
      }
    });

    // Remove pins no longer in the list
    Object.keys(markers).forEach(function(id) {
      if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; }
    });

    // Fit bounds when we have pins (only on first real load)
    if (pins.length > 0 && window._firstFit !== false) {
      window._firstFit = false;
      var latlngs = pins.map(function(p){ return [p.lat, p.lng]; });
      map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 14 });
    }
  };
</script>
</body>
</html>`;
}

export function LeafletMapView({ pins, defaultCenter = [-25.842, 28.178], defaultZoom = 12, style }: Props) {
  const webViewRef = useRef<WebView>(null);
  const initialised = useRef(false);
  const html = useRef(buildHtml(defaultCenter, defaultZoom));

  // Push pin updates into the running WebView via injectedJavaScript.
  useEffect(() => {
    if (!initialised.current) return; // wait for onLoad
    webViewRef.current?.injectJavaScript(
      `window.updatePins(${JSON.stringify(JSON.stringify(pins))}); true;`
    );
  }, [pins]);

  function handleLoad() {
    initialised.current = true;
    webViewRef.current?.injectJavaScript(
      `window.updatePins(${JSON.stringify(JSON.stringify(pins))}); true;`
    );
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: html.current, baseUrl: "https://openstreetmap.org" }}
        style={styles.webview}
        onLoad={handleLoad}
        javaScriptEnabled
        domStorageEnabled
        // Serve OSM tiles from disk cache first; only fetch from network on cache miss.
        // Tiles already viewed load instantly and work offline.
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        startInLoadingState={false}
        scalesPageToFit={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", borderRadius: 6 },
  webview: { flex: 1, backgroundColor: "transparent" },
});
