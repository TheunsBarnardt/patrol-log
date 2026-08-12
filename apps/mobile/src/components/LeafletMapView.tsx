/**
 * LeafletMapView — embeds a Leaflet/OpenStreetMap map.
 * Native: WebView. Web: iframe. Pin updates via injectJavaScript.
 * Assets/tiles load via same-origin Pages proxies (mobile carriers often block CDNs).
 */

import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { HtmlMapHost, type HtmlMapHostHandle } from "./HtmlMapHost";
import { mapBootstrapHtml, mapLeafletScript } from "../lib/mapAssets";
import { radii } from "../theme";

export interface LeafletPin {
  id: string;
  lat: number;
  lng: number;
  color: string;
  title: string;
  body: string;
}

interface Props {
  pins: LeafletPin[];
  defaultCenter?: [number, number];
  defaultZoom?: number;
  style?: object;
}

function buildHtml(defaultCenter: [number, number], defaultZoom: number): string {
  const { head, tileLayerJs } = mapBootstrapHtml(
    ".custom-dot{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}",
  );
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
${head}
</head>
<body>
<div id="map"></div>
${mapLeafletScript()}
<script>
  var map = L.map('map', { zoomControl: true }).setView(${JSON.stringify(defaultCenter)}, ${defaultZoom});
  ${tileLayerJs}
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

    Object.keys(markers).forEach(function(id) {
      if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; }
    });

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
  const hostRef = useRef<HtmlMapHostHandle>(null);
  const initialised = useRef(false);
  const html = useRef(buildHtml(defaultCenter, defaultZoom));

  useEffect(() => {
    if (!initialised.current) return;
    hostRef.current?.injectJavaScript(
      `window.updatePins(${JSON.stringify(JSON.stringify(pins))}); true;`,
    );
  }, [pins]);

  function handleLoad() {
    initialised.current = true;
    hostRef.current?.injectJavaScript(
      `window.updatePins(${JSON.stringify(JSON.stringify(pins))}); true;`,
    );
  }

  return (
    <View style={[styles.container, style]}>
      <HtmlMapHost
        ref={hostRef}
        html={html.current}
        style={styles.webview}
        onLoad={handleLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", borderRadius: radii.lg },
  webview: { flex: 1, backgroundColor: "transparent" },
});
