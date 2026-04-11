// FDL: blueprints/data/live-patroller-map.blueprint.yaml
// Live tracking: polls every 10s and injects updated pin positions without
// reloading the WebView, giving a smooth near-real-time experience.

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { api } from "../lib/api";
import { colors, spacing } from "../theme";
import type { LiveMapPin } from "@patrol-log/shared";

const POLL_INTERVAL = 10_000; // 10 seconds — fast enough to feel live

const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#e8e0d8}
  .patrol-dot{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);font-size:11px;font-weight:800;color:#fff;text-align:center;line-height:1}
  .patrol-dot.stale{opacity:.5;filter:grayscale(1)}
  .pulse-ring{position:absolute;width:36px;height:36px;border-radius:50%;animation:pulse 2s ease-out infinite;opacity:0}
  @keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.5);opacity:0}}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map = L.map('map',{zoomControl:true}).setView([-25.842,28.178],12);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'}).addTo(map);

var markers={};
var fitted=false;

function makeIcon(color,callSign,stale){
  var el=document.createElement('div');
  el.style.position='relative';
  if(!stale){
    var ring=document.createElement('div');
    ring.className='pulse-ring';
    ring.style.background=color;
    el.appendChild(ring);
  }
  var dot=document.createElement('div');
  dot.className='patrol-dot'+(stale?' stale':'');
  dot.style.background=color;
  dot.textContent=callSign.length>4?callSign.slice(0,4):callSign;
  el.appendChild(dot);
  return L.divIcon({className:'',html:el.outerHTML,iconSize:[36,36],iconAnchor:[18,18],popupAnchor:[0,-20]});
}

window.updatePins=function(json){
  var pins=JSON.parse(json);
  var seen={};
  pins.forEach(function(p){
    seen[p.patrol_id]=true;
    var color=p.stale?'#9CA3AF':'#1ABC9C';
    var icon=makeIcon(color,p.call_sign,p.stale);
    if(markers[p.patrol_id]){
      markers[p.patrol_id].setLatLng([p.lat,p.lng]);
      markers[p.patrol_id].setIcon(icon);
      var popup='<b>'+p.call_sign+'</b><br/>'+p.patrol_type+'<br/>'+p.duration_on_patrol_min+' min on patrol'+(p.stale?'<br/><span style="color:#F59E0B">⚠ stale</span>':'');
      markers[p.patrol_id].setPopupContent(popup);
    } else {
      var popup='<b>'+p.call_sign+'</b><br/>'+p.patrol_type+'<br/>'+p.duration_on_patrol_min+' min on patrol'+(p.stale?'<br/><span style="color:#F59E0B">⚠ stale</span>':'');
      markers[p.patrol_id]=L.marker([p.lat,p.lng],{icon:icon}).bindPopup(popup).addTo(map);
    }
  });
  Object.keys(markers).forEach(function(id){
    if(!seen[id]){map.removeLayer(markers[id]);delete markers[id];}
  });
  if(!fitted&&pins.length>0){
    fitted=true;
    var lls=pins.map(function(p){return[p.lat,p.lng]});
    map.fitBounds(L.latLngBounds(lls),{padding:[40,40],maxZoom:14});
  }
};
</script>
</body>
</html>`;

export function LivePatrollerMapScreen() {
  const [pins, setPins] = useState<LiveMapPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function pushPins(p: LiveMapPin[]) {
    webViewRef.current?.injectJavaScript(
      `window.updatePins(${JSON.stringify(JSON.stringify(p))}); true;`,
    );
  }

  async function refresh() {
    try {
      const res = await api.liveMapSnapshot();
      setPins(res.pins);
      setError(null);
      if (loaded.current) pushPins(res.pins);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    timer.current = setInterval(refresh, POLL_INTERVAL);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  function handleLoad() {
    loaded.current = true;
    pushPins(pins);
  }

  const active = pins.filter((p) => !p.stale).length;
  const stale = pins.filter((p) => p.stale).length;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>
          {loading ? "Connecting…" : `${active} active${stale > 0 ? ` · ${stale} stale` : ""} · updates every 10s`}
        </Text>
        {error && <Text style={styles.errorText}>⚠ {error}</Text>}
      </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  statusText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  errorText: { fontSize: 12, color: colors.danger },
  map: { flex: 1 },
});
