// FDL: blueprints/data/hotspots-map.blueprint.yaml
// Managed hotspots: translucent circles sized by diameter_km, coloured by rating.

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HtmlMapHost, type HtmlMapHostHandle } from "../components/HtmlMapHost";
import { api } from "../lib/api";
import { mapBootstrapHtml, mapLeafletScript } from "../lib/mapAssets";
import { colors, spacing } from "../theme";
import type { HotspotPeriod, HotspotPin } from "@patrol-log/shared";

const PERIODS: Array<{ label: string; value: HotspotPeriod }> = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

function ratingColor(rating: number): string {
  if (rating >= 5) return colors.danger;
  if (rating >= 4) return "#F97316";
  if (rating >= 3) return colors.warning;
  if (rating >= 2) return colors.success;
  return colors.textMuted;
}

function buildHotspotMapHtml(): string {
  const { head, tileLayerJs } = mapBootstrapHtml();
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
${head}
</head>
<body>
<div id="map"></div>
${mapLeafletScript()}
<script>
var map=L.map('map',{zoomControl:true}).setView([-25.842,28.178],12);
${tileLayerJs}
var circles=[];
var fitted=false;

function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.renderPins=function(json){
  circles.forEach(function(c){map.removeLayer(c);});
  circles=[];
  fitted=false;

  var pins=JSON.parse(json);
  if(pins.length===0)return;

  pins.forEach(function(p){
    var radiusM=Math.max(25, (Number(p.diameter_km)||0.5)*500); // diameter km → radius metres
    var color=p._color||'#EAB308';
    var title=esc(p.title||p.type||'Hotspot');
    var desc=esc(p.description||'');
    var rating=p.rating!=null?p.rating:'—';
    var diam=p.diameter_km!=null?p.diameter_km:'—';
    var c=L.circle([p.lat,p.lng],{
      radius:radiusM,
      color:color,
      fillColor:color,
      fillOpacity:0.25,
      weight:1.5,
      opacity:0.65
    }).bindPopup(
      '<b>'+title+'</b><br/>Rating: '+rating+'/5<br/>Diameter: '+diam+' km'+
      (desc?'<br/><br/>'+desc:'')
    ).addTo(map);
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
}

export function HotspotsMapScreen() {
  const [period, setPeriod] = useState<HotspotPeriod>("7d");
  const [pins, setPins] = useState<HotspotPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HtmlMapHostHandle>(null);
  const loaded = useRef(false);
  const pinsRef = useRef<HotspotPin[]>([]);
  pinsRef.current = pins;

  function pushPins(p: HotspotPin[]) {
    const enriched = p.map((pin) => ({
      ...pin,
      _color: ratingColor(pin.rating ?? 3),
    }));
    hostRef.current?.injectJavaScript(
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
      .catch(() => {
        setError(
          pinsRef.current.length > 0
            ? "Connection lost · showing last known hotspots"
            : "Connection lost · try again shortly",
        );
      })
      .finally(() => setLoading(false));
  }, [period]);

  function handleLoad() {
    loaded.current = true;
    pushPins(pins);
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
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
      </View>

      {loading && (
        <View style={styles.banner}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.bannerText}>Loading hotspots…</Text>
        </View>
      )}
      {error && (
        <View style={[styles.banner, styles.bannerErr]}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}
      {!loading && !error && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {pins.length} hotspot{pins.length === 1 ? "" : "s"} · circle size = diameter (km)
          </Text>
        </View>
      )}

      <View style={styles.map}>
        <HtmlMapHost
          ref={hostRef}
          html={buildHotspotMapHtml()}
          onLoad={handleLoad}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  pillTextActive: { color: "#fff" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  bannerErr: { backgroundColor: "#FEF2F2" },
  bannerText: { fontSize: 12, color: colors.textMuted, fontWeight: "500" },
  map: { flex: 1, marginTop: 4 },
});
