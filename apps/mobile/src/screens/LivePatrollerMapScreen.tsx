// FDL: blueprints/data/live-patroller-map.blueprint.yaml
// Live tracking: polls every 10s and injects updated pin positions without
// reloading the WebView, giving a smooth near-real-time experience.
// Markers: Uber-style car / walk / stationary + call-sign labels.

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HtmlMapHost, type HtmlMapHostHandle } from "../components/HtmlMapHost";
import { api } from "../lib/api";
import { mapBootstrapHtml, mapLeafletScript } from "../lib/mapAssets";
import { colors, spacing } from "../theme";
import type { LiveMapPin } from "@patrol-log/shared";

const POLL_INTERVAL = 10_000;

function buildLiveMapHtml(): string {
  const { head, tileLayerJs } = mapBootstrapHtml(
    ".live-pin{background:transparent!important;border:0!important}",
  );
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
var map = L.map('map',{zoomControl:true}).setView([-25.842,28.178],12);
${tileLayerJs}

var markers={};
var fitted=false;
var MOVING=0.8;

function esc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function movementOf(p){
  if(p.patrol_type==='vehicle') return 'car';
  if(p.patrol_type==='static'||p.patrol_type==='sector_monitoring'||p.patrol_type==='ops'||p.patrol_type==='responding') return 'stationary';
  return 'walk';
}
function movementLabel(m){
  if(m==='car') return 'In vehicle';
  if(m==='walk') return 'On foot';
  return 'Stationary';
}
function makeIcon(p){
  var m=movementOf(p);
  var stale=!!p.stale;
  var moving=p.speed!=null && p.speed>=MOVING;
  var heading=(m==='car' && moving && p.heading!=null)?p.heading:0;
  var fill=stale?'#9CA3AF':(m==='car'?'#0B3D8C':m==='walk'?'#1E7A3A':'#F5C518');
  var ring=stale?'#6B7280':'#fff';
  var glyph;
  if(m==='car'){
    glyph='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="display:block;transform:rotate('+heading+'deg)"><path fill="'+ring+'" d="M5 11.5 6.2 7.8A2 2 0 0 1 8.1 6.5h7.8a2 2 0 0 1 1.9 1.3L19 11.5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-.5H8V16.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-5Z"/><circle cx="7.5" cy="15" r="1.4" fill="'+fill+'"/><circle cx="16.5" cy="15" r="1.4" fill="'+fill+'"/><path fill="'+fill+'" d="M7.2 8h9.6l1.1 3.2H6.1L7.2 8Z"/></svg>';
  } else if(m==='walk'){
    glyph='<svg width="20" height="20" viewBox="0 0 24 24" fill="'+ring+'" style="display:block"><circle cx="13.5" cy="4.5" r="2.2"/><path d="M10.2 8.2c.7-.5 1.7-.6 2.6-.2l2.2 1.1 2.1-.7.7 1.9-2.8.9-1.5-.7-.8 2.2 2.4 1.6-.9 1.7-3.1-2.1c-.7-.5-1-1.4-.7-2.2l1-3.5-1.4-.9Z"/><path d="M9.2 20.5 11 14.8l2.2 1.5 1.8 4.2-2 .9-1.2-2.8-1.1.7-.7 1.2Z"/></svg>';
  } else {
    glyph='<svg width="18" height="18" viewBox="0 0 24 24" fill="'+ring+'" style="display:block"><circle cx="12" cy="6" r="2.4"/><path d="M8.5 10.2c0-1.2 1.5-2.2 3.5-2.2s3.5 1 3.5 2.2V14h-1.6v7.2h-3.8V14H8.5v-3.8Z"/></svg>';
  }
  var sub=(m==='car' && p.vehicle_registration)?esc(p.vehicle_registration):movementLabel(m);
  var html='<div style="display:flex;flex-direction:column;align-items:center;gap:2px;opacity:'+(stale?0.55:1)+'">'+
    '<div style="width:40px;height:40px;border-radius:9999px;background:'+fill+';border:3px solid '+ring+';box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center">'+glyph+'</div>'+
    '<div style="margin-top:1px;padding:2px 7px;border-radius:9999px;background:rgba(17,24,39,.92);color:#fff;font:700 11px/1.2 system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);max-width:120px;overflow:hidden;text-overflow:ellipsis">'+esc(p.call_sign)+'</div>'+
    '<div style="padding:1px 6px;border-radius:9999px;background:rgba(255,255,255,.92);color:#374151;font:600 10px/1.2 system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);max-width:120px;overflow:hidden;text-overflow:ellipsis">'+sub+'</div>'+
  '</div>';
  return L.divIcon({className:'live-pin',html:html,iconSize:[40,68],iconAnchor:[20,20],popupAnchor:[0,-28]});
}
function popupHtml(p){
  var m=movementOf(p);
  var lines=['<b>'+esc(p.call_sign)+'</b>',esc(movementLabel(m)),esc(p.patrol_type)+' patrol'];
  if(p.vehicle_registration) lines.push('Vehicle: '+esc(p.vehicle_registration));
  lines.push(p.duration_on_patrol_min+' min on patrol');
  if(p.speed!=null) lines.push(Math.round(p.speed*3.6)+' km/h');
  if(p.stale) lines.push('<span style="color:#F59E0B">⚠ stale</span>');
  return lines.join('<br/>');
}
window.updatePins=function(json){
  var pins=JSON.parse(json);
  var seen={};
  pins.forEach(function(p){
    seen[p.patrol_id]=true;
    var icon=makeIcon(p);
    var popup=popupHtml(p);
    if(markers[p.patrol_id]){
      markers[p.patrol_id].setLatLng([p.lat,p.lng]);
      markers[p.patrol_id].setIcon(icon);
      markers[p.patrol_id].setPopupContent(popup);
    } else {
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
}

export function LivePatrollerMapScreen() {
  const [pins, setPins] = useState<LiveMapPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HtmlMapHostHandle>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function pushPins(p: LiveMapPin[]) {
    hostRef.current?.injectJavaScript(
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
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function handleLoad() {
    loaded.current = true;
    pushPins(pins);
  }

  const active = pins.filter((p) => !p.stale).length;
  const stale = pins.filter((p) => p.stale).length;
  const cars = pins.filter((p) => p.patrol_type === "vehicle").length;
  const walks = pins.filter((p) => p.patrol_type === "foot").length;
  const other = pins.filter(
    (p) =>
      p.patrol_type === "static" ||
      p.patrol_type === "sector_monitoring" ||
      p.patrol_type === "ops" ||
      p.patrol_type === "responding",
  ).length;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.statusBar}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>
          {loading
            ? "Connecting…"
            : `${active} live${stale > 0 ? ` · ${stale} stale` : ""} · ${cars} car · ${walks} walk · ${other} other`}
        </Text>
        {error && <Text style={styles.errorText}>⚠ {error}</Text>}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
      ) : (
        <HtmlMapHost
          ref={hostRef}
          html={buildLiveMapHtml()}
          style={styles.map}
          onLoad={handleLoad}
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
