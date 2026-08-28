import { getMapAssetOrigin } from "../config";

/**
 * Leaflet + OpenStreetMap tiles via same-origin Pages proxies (works on blocked mobile CDNs).
 *
 * Mobile Safari / Chrome / Android WebView often paint tiles once, then go gray:
 * the map container is height:100% of a flex parent that later resizes (address
 * bar, status line, keyboard), Leaflet keeps a 0×0 pane, and new tiles never
 * draw. Fixed viewport + invalidateSize keep-alive fixes that.
 */
export function mapBootstrapHtml(extraHeadCss = ""): { head: string; tileLayerJs: string } {
  const origin = getMapAssetOrigin();
  return {
    head: `<base href="${origin}/"/>
<link rel="stylesheet" href="${origin}/map-assets/leaflet.css"/>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;position:fixed;inset:0;background:#e8e0d8;-webkit-text-size-adjust:100%}
#map{position:absolute;inset:0;width:100%;height:100%;background:#e8e0d8}
.leaflet-container{background:#e8e0d8;width:100%;height:100%}
.leaflet-tile-container img{max-width:none!important;-webkit-user-select:none}
${extraHeadCss}
</style>`,
    tileLayerJs: `L.tileLayer('${origin}/map-tiles/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
${mapKeepAliveJs()}`,
  };
}

/** Call after `var map = L.map(...)` so tiles survive mobile viewport / WebView pauses. */
export function mapKeepAliveJs(): string {
  return `(function(){
  if(typeof map==='undefined')return;
  function fix(){try{map.invalidateSize({animate:false});}catch(e){}}
  setTimeout(fix,80);
  setTimeout(fix,300);
  setTimeout(fix,1000);
  window.addEventListener('resize',fix);
  window.addEventListener('orientationchange',function(){setTimeout(fix,250);});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)setTimeout(fix,150);});
  window.addEventListener('pageshow',function(){setTimeout(fix,150);});
  map.on('tileerror',function(e){
    var t=e.tile;if(!t||(t._retries||0)>=2)return;
    t._retries=(t._retries||0)+1;
    setTimeout(function(){if(t.src)t.src=t.src;},700*t._retries);
  });
})();`;
}

export function mapLeafletScript(): string {
  const origin = getMapAssetOrigin();
  return `<script src="${origin}/map-assets/leaflet.js"><\/script>`;
}
