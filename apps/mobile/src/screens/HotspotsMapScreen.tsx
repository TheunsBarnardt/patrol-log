// FDL: blueprints/data/hotspots-map.blueprint.yaml
// Incidents are rendered as translucent circle overlays sized by severity —
// overlapping circles create a visual heat-density effect.

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { api } from "../lib/api";
import { colors, spacing } from "../theme";
import type { HotspotPeriod, HotspotPin } from "@patrol-log/shared";

const PERIODS: Array<{ label: string; value: HotspotPeriod }> = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

// Severity → {color, radius in metres}
const SEVERITY_MAP: Record<string, { color: string; radius: number }> = {
  critical: { color: "#DC2626", radius: 300 },
  high:     { color: "#F97316", radius: 200 },
  medium:   { color: "#EAB308", radius: 130 },
  low:      { color: "#6B7280", radius: 80 },
};

const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#e8e0d8}</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:true}).setView([-25.842,28.178],12);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'}).addTo(map);
var circles=[];
var fitted=false;

window.renderPins=function(json){
  // Remove old circles
  circles.forEach(function(c){map.removeLayer(c);});
  circles=[];
  fitted=false;

  var pins=JSON.parse(json);
  if(pins.length===0)return;

  pins.forEach(function(p){
    var cfg=p._cfg;
    var c=L.circle([p.lat,p.lng],{
      radius:cfg.radius,
      color:cfg.color,
      fillColor:cfg.color,
      fillOpacity:0.25,
      weight:1.5,
      opacity:0.6
    }).bindPopup('<b>'+p.type+'</b><br/>Severity: '+p.severity+'<br/>'+new Date(p.occurred_at).toLocaleDateString()).addTo(map);
    circles.push(c);
  });

  if(!fitted){
    fitted=true;
    var lls=pins.map(function(p){return[p.lat,p.lng]});
    map.fitBounds(L.latLngBounds(lls),{padding:[40,40],maxZoom:14});
  }
};
</script>
</body>
</html>`;

export function HotspotsMapScreen() {
  const [period, setPeriod] = useState<HotspotPeriod>("7d");
  const [pins, setPins] = useState<HotspotPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const loaded = useRef(false);

  function pushPins(p: HotspotPin[]) {
    // Attach severity config to each pin before serialising
    const enriched = p.map((pin) => ({ ...pin, _cfg: SEVERITY_MAP[pin.severity] ?? SEVERITY_MAP.low }));
    webViewRef.current?.injectJavaScript(
      `window.renderPins(${JSON.stringify(JSON.stringify(enriched))}); true;`,
    );
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .hotspots(period)
      .then((r) => {
        setPins(r.pins);
        if (loaded.current) pushPins(r.pins);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Network error";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [period]);

  function handleLoad() {
    loaded.current = true;
    pushPins(pins);
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {/* Period pills */}
      <View style={styles.pillRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[styles.pill, period === p.value && styles.pillActive]}
            onPress={() => setPeriod(p.value)}
          >
            <Text style={[styles.pillText, period === p.value && styles.pillTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        {!loading && (
          <Text style={styles.count}>{pins.length} incident{pins.length !== 1 ? "s" : ""}</Text>
        )}
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
      ) : (
        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{ html: MAP_HTML, baseUrl: "https://carto.com" }}
          style={styles.map}
          onLoad={handleLoad}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
          startInLoadingState={false}
          scalesPageToFit={false}
        />
      )}

      {/* Severity legend */}
      {!loading && (
        <View style={styles.legend}>
          {Object.entries(SEVERITY_MAP).map(([sev, cfg]) => (
            <View key={sev} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: cfg.color }]} />
              <Text style={styles.legendLabel}>{sev}</Text>
            </View>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.sm,
    alignItems: "center",
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
  },
  pillActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  pillText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  pillTextActive: { color: "#fff" },
  count: { marginLeft: "auto", fontSize: 12, color: colors.textMuted },
  errorBanner: { backgroundColor: "#FEF2F2", margin: spacing.sm, borderRadius: 6, padding: spacing.sm },
  errorText: { color: "#991B1B", fontSize: 12, textAlign: "center" },
  map: { flex: 1 },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, color: colors.textMuted, textTransform: "capitalize" },
});
