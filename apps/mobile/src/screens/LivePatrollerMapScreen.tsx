// FDL: blueprints/data/live-patroller-map.blueprint.yaml
// Live tracking: polls every 10s and injects updated pin positions without
// reloading the WebView, giving a smooth near-real-time experience.
// Markers: Uber-style car / walk / stationary + call-sign labels.

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Location from "expo-location";
import { HtmlMapHost, type HtmlMapHostHandle } from "../components/HtmlMapHost";
import { api } from "../lib/api";
import { ensureHeartbeatForActivePatrol, noteLocalCoords, startHeartbeatForPatrol, stopHeartbeat } from "../lib/heartbeat";
import { mapBootstrapHtml, mapLeafletScript } from "../lib/mapAssets";
import { cacheGet, cacheSet } from "../lib/offlineCache";
import {
  bindPatrolTrack,
  formatTrackKm,
  getPatrolTrack,
  subscribePatrolTrack,
} from "../lib/patrolTrack";
import { storage } from "../lib/storage";
import { useAuthStore } from "../store/auth";
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
var peerLines={};
var selectedId=null;
var selfPatrolId=null;
var fitted=false;
var follow=true;
var pathLine=null;
var pathLatLngs=[];
var MOVING=0.8;

function esc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function colorFor(cs){
  var h=0,s=String(cs||'');
  for(var i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0;
  return 'hsl('+(((h%360)+360)%360)+',70%,38%)';
}
function haversineM(a,b){
  var R=6371000, toRad=function(d){return d*Math.PI/180;};
  var dLat=toRad(b[0]-a[0]), dLng=toRad(b[1]-a[1]);
  var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return 2*R*Math.asin(Math.min(1,Math.sqrt(s)));
}
function trailSegs(pts){
  var segs=[], cur=[];
  for(var i=0;i<(pts||[]).length;i++){
    var p=pts[i];
    if(cur.length && haversineM(cur[cur.length-1], p)>700){
      if(cur.length>=2) segs.push(cur);
      cur=[p];
      continue;
    }
    cur.push(p);
  }
  if(cur.length>=2) segs.push(cur);
  return segs;
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
  if(p.path_km!=null && p.path_km>0) lines.push(p.path_km+' km covered');
  if(p.stale) lines.push('<span style="color:#F59E0B">⚠ stale</span>');
  lines.push('<span style="color:#6B7280">Tap pin to highlight route</span>');
  return lines.join('<br/>');
}
window.setSelfPatrolId=function(id){ selfPatrolId=id||null; };
window.selectPeer=function(id){
  selectedId=(selectedId===id)?null:id;
  restylePeerPaths();
};
function restylePeerPaths(){
  Object.keys(peerLines).forEach(function(id){
    var line=peerLines[id];
    if(!line) return;
    var on=selectedId===id;
    try{ line.setStyle({weight:on?7:4, opacity:on?0.95:0.42}); }catch(e){}
    if(on && line.bringToFront) line.bringToFront();
  });
  if(pathLine && pathLine.bringToBack) pathLine.bringToBack();
}
function setPeerPath(id, pts, cs){
  if(peerLines[id]){ try{ map.removeLayer(peerLines[id]); }catch(e){} delete peerLines[id]; }
  if(selfPatrolId && id===selfPatrolId) return;
  var segs=trailSegs(pts);
  if(!segs.length) return;
  var on=selectedId===id;
  var line=L.polyline(segs,{
    color:colorFor(cs),
    weight:on?7:4,
    opacity:on?0.95:0.42,
    lineJoin:'round',
    lineCap:'round'
  }).addTo(map);
  line.on('click', function(){ window.selectPeer(id); });
  peerLines[id]=line;
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
    markers[p.patrol_id].off('click');
    markers[p.patrol_id].on('click', function(){ window.selectPeer(p.patrol_id); });
    setPeerPath(p.patrol_id, p.path||[], p.call_sign);
  });
  Object.keys(markers).forEach(function(id){
    if(!seen[id]){map.removeLayer(markers[id]);delete markers[id];}
  });
  Object.keys(peerLines).forEach(function(id){
    if(!seen[id]){ try{ map.removeLayer(peerLines[id]); }catch(e){} delete peerLines[id]; }
  });
  restylePeerPaths();
  if(!fitted&&pins.length>0&&!selfMarker){
    fitted=true;
    function fit(){
      try{
        map.invalidateSize({animate:false});
        var lls=pins.map(function(p){return[p.lat,p.lng]});
        map.fitBounds(L.latLngBounds(lls),{padding:[40,40],maxZoom:14});
      }catch(e){}
    }
    fit();
    setTimeout(fit,250);
    setTimeout(fit,700);
  }
};
var selfMarker=null;
map.on('dragstart',function(){ follow=false; });
window.setFollow=function(on){
  follow=!!on;
  if(follow && selfMarker){
    try{ map.panTo(selfMarker.getLatLng(),{animate:true}); }catch(e){}
  }
};
window.updateSelf=function(lat,lng){
  if(typeof lat!=='number'||typeof lng!=='number'||!isFinite(lat)||!isFinite(lng))return;
  var ll=[lat,lng];
  if(selfMarker){selfMarker.setLatLng(ll);}
  else {
    selfMarker=L.circleMarker(ll,{
      radius:9,color:'#fff',weight:3,fillColor:'#2563EB',fillOpacity:1
    }).bindPopup('You').addTo(map);
    if(follow) try{ map.setView(ll, Math.max(map.getZoom(),16), {animate:false}); }catch(e){}
  }
  if(follow && selfMarker){
    try{ map.panTo(ll,{animate:true,duration:0.35}); }catch(e){}
  }
};
function drawSelfPath(){
  if(pathLine){ try{ map.removeLayer(pathLine); }catch(e){} pathLine=null; }
  var segs=trailSegs(pathLatLngs);
  if(!segs.length) return;
  pathLine=L.polyline(segs,{color:'#0B3D8C',weight:5,opacity:0.85,lineJoin:'round',lineCap:'round'}).addTo(map);
  if(pathLine.bringToBack) pathLine.bringToBack();
}
window.appendPath=function(lat,lng){
  if(typeof lat!=='number'||typeof lng!=='number'||!isFinite(lat)||!isFinite(lng))return;
  pathLatLngs.push([lat,lng]);
  drawSelfPath();
};
window.setPath=function(json){
  try{ pathLatLngs=JSON.parse(json)||[]; }catch(e){ pathLatLngs=[]; }
  drawSelfPath();
};
</script>
</body>
</html>`;
}

export function LivePatrollerMapScreen() {
  const myCallSign = useAuthStore((s) => s.profile?.call_sign);
  const [pins, setPins] = useState<LiveMapPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionLost, setConnectionLost] = useState(false);
  const [km, setKm] = useState(0);
  const [following, setFollowing] = useState(true);
  const [isPassenger, setIsPassenger] = useState(false);
  const [sharingEnabled, setSharingEnabled] = useState(true);
  const hostRef = useRef<HtmlMapHostHandle>(null);
  const loaded = useRef(false);
  const pinsRef = useRef<LiveMapPin[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const htmlRef = useRef(buildLiveMapHtml());
  const selfRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const myPatrolIdRef = useRef<string | null>(null);
  const myRoleRef = useRef<"primary" | "joined" | null>(null);
  const myCallSignRef = useRef(myCallSign);
  myCallSignRef.current = myCallSign;
  pinsRef.current = pins;

  function overlaySelf(list: LiveMapPin[]): LiveMapPin[] {
    const self = selfRef.current;
    if (!self || Date.now() - self.at > 45_000) return list;
    const callSign = myCallSignRef.current;
    // Only overlay onto *your* pin. Passengers must not move the primary's marker.
    if (!callSign || myRoleRef.current === "joined") return list;
    return list.map((p) => {
      if (p.call_sign === callSign) {
        return {
          ...p,
          lat: self.lat,
          lng: self.lng,
          stale: false,
          last_update: new Date().toISOString(),
        };
      }
      return p;
    });
  }

  function publishPins(list: LiveMapPin[]) {
    const next = overlaySelf(list);
    pinsRef.current = next;
    setPins(next);
    if (loaded.current) {
      hostRef.current?.injectJavaScript(
        `window.updatePins(${JSON.stringify(JSON.stringify(next))}); true;`,
      );
    }
  }

  function pushPathToMap() {
    const pts = getPatrolTrack().points.map((p) => [p.lat, p.lng]);
    hostRef.current?.injectJavaScript(
      `window.setPath(${JSON.stringify(JSON.stringify(pts))}); true;`,
    );
  }

  function recenter() {
    setFollowing(true);
    hostRef.current?.injectJavaScript("window.setFollow(true); true;");
  }

  function pushSelf(lat: number, lng: number) {
    hostRef.current?.injectJavaScript(`window.updateSelf(${lat},${lng}); true;`);
    publishPins(pinsRef.current);
  }

  async function refresh() {
    try {
      const res = await api.liveMapSnapshot();
      setConnectionLost(false);
      const sharing = res.sharing_enabled !== false;
      setSharingEnabled(sharing);
      const pins = sharing ? res.pins : [];
      await cacheSet("liveMap", pins);
      publishPins(pins);
    } catch {
      const cached = await cacheGet<LiveMapPin[]>("liveMap");
      const last = pinsRef.current.length > 0 ? pinsRef.current : cached?.data ?? [];
      if (last.length > 0) {
        publishPins(last.map((p) => ({ ...p, stale: true })));
      }
      setConnectionLost(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cachedId = await ensureHeartbeatForActivePatrol();
      if (cachedId) myPatrolIdRef.current = cachedId;
      try {
        const active = await api.activePatrol();
        if (cancelled) return;
        if (active?.patrol_id) {
          myPatrolIdRef.current = active.patrol_id;
          myRoleRef.current = active.my_role;
          setIsPassenger(active.my_role === "joined");
          try {
            await storage.setActivePatrolCache(JSON.stringify(active));
          } catch {
            /* ignore */
          }
          if (active.my_role === "joined") {
            stopHeartbeat();
          } else {
            hostRef.current?.injectJavaScript(
              `window.setSelfPatrolId(${JSON.stringify(active.patrol_id)}); true;`,
            );
            await startHeartbeatForPatrol(active.patrol_id);
            await bindPatrolTrack(active.patrol_id);
          }
        }
      } catch {
        /* cache path already tried */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await cacheGet<LiveMapPin[]>("liveMap");
      if (!cancelled && cached?.data?.length) {
        publishPins(cached.data.map((p) => ({ ...p, stale: true })));
        setLoading(false);
        setConnectionLost(true);
      }

      await refresh();
      if (cancelled) return;
      timer.current = setInterval(() => {
        void refresh();
      }, POLL_INTERVAL);
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    const lastLen = { n: 0 };
    return subscribePatrolTrack((snap) => {
      if (myRoleRef.current === "joined") return;
      setKm(snap.km);
      if (!loaded.current) return;
      if (snap.points.length === 0) {
        lastLen.n = 0;
        pushPathToMap();
        return;
      }
      if (snap.points.length <= lastLen.n || lastLen.n === 0) {
        lastLen.n = snap.points.length;
        pushPathToMap();
        return;
      }
      const p = snap.points[snap.points.length - 1];
      if (p) {
        hostRef.current?.injectJavaScript(`window.appendPath(${p.lat},${p.lng}); true;`);
      }
      lastLen.n = snap.points.length;
    });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let webWatchId: number | null = null;
    let cancelled = false;

    function onFix(
      lat: number,
      lng: number,
      extra?: { heading?: number | null; speed?: number | null; accuracy?: number | null },
    ) {
      selfRef.current = { lat, lng, at: Date.now() };
      noteLocalCoords({ lat, lng, heading: extra?.heading, speed: extra?.speed, accuracy: extra?.accuracy });
      if (loaded.current) pushSelf(lat, lng);
    }

    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
      webWatchId = navigator.geolocation.watchPosition(
        (pos) =>
          onFix(pos.coords.latitude, pos.coords.longitude, {
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            accuracy: pos.coords.accuracy,
          }),
        (err) => console.warn("[live-map] geolocation", err.message),
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
      );
    }

    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || cancelled || webWatchId != null) return;
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 15_000,
            distanceInterval: 0,
            mayShowUserSettingsDialog: false,
          },
          (pos) =>
            onFix(pos.coords.latitude, pos.coords.longitude, {
              heading: pos.coords.heading,
              speed: pos.coords.speed,
              accuracy: pos.coords.accuracy,
            }),
        );
      } catch (err) {
        console.warn("[live-map] self watch failed", err);
      }
    })();
    return () => {
      cancelled = true;
      if (webWatchId != null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(webWatchId);
      }
      try {
        sub?.remove();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function handleLoad() {
    loaded.current = true;
    if (myPatrolIdRef.current && myRoleRef.current !== "joined") {
      hostRef.current?.injectJavaScript(
        `window.setSelfPatrolId(${JSON.stringify(myPatrolIdRef.current)}); true;`,
      );
    }
    publishPins(pinsRef.current);
    if (selfRef.current) pushSelf(selfRef.current.lat, selfRef.current.lng);
    if (myRoleRef.current !== "joined") pushPathToMap();
    if (following) hostRef.current?.injectJavaScript("window.setFollow(true); true;");
    hostRef.current?.injectJavaScript(
      "try{if(typeof map!=='undefined')map.invalidateSize({animate:false});}catch(e){} true;",
    );
  }

  const active = pins.filter((p) => !p.stale).length;
  const stale = pins.filter((p) => p.stale).length;

  const statusLine = loading
    ? "Connecting…"
    : connectionLost
      ? pins.length > 0
        ? "Connection lost · showing last known locations"
        : "Connection lost · trying again…"
      : !sharingEnabled
        ? "Live locations hidden by dispatch · your GPS still updates for admin"
        : `${active} live${stale > 0 ? ` · ${stale} stale` : ""}${isPassenger ? "" : ` · ${formatTrackKm(km)}`} · tap a pin to see their route`;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, (connectionLost || !sharingEnabled) && styles.statusDotLost]} />
        <Text style={[styles.statusText, (connectionLost || !sharingEnabled) && styles.statusTextLost]}>{statusLine}</Text>
      </View>

      <View style={styles.map}>
        <HtmlMapHost ref={hostRef} html={htmlRef.current} style={styles.mapFill} onLoad={handleLoad} />
        {loading && (
          <View style={styles.mapOverlay}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        {!isPassenger && (
          <View style={styles.kmBadge} pointerEvents="none">
            <Text style={styles.kmValue}>{formatTrackKm(km)}</Text>
            <Text style={styles.kmLabel}>this patrol</Text>
          </View>
        )}
        <Pressable style={styles.recenter} onPress={recenter} accessibilityLabel="Center on me">
          <FontAwesome5 name="location-arrow" size={16} color="#fff" />
        </Pressable>
      </View>
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
  statusDotLost: { backgroundColor: colors.warning },
  statusText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  statusTextLost: { color: colors.warning, fontWeight: "600" },
  map: { flex: 1, backgroundColor: "#e8e0d8" },
  mapFill: { flex: 1 },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(232,224,216,0.55)",
  },
  kmBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: "rgba(11,20,32,0.88)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kmValue: { color: "#fff", fontSize: 18, fontWeight: "800" },
  kmLabel: { color: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: "600", marginTop: 1 },
  recenter: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
