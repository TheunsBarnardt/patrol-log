import { getMapAssetOrigin } from "../config";

/** Leaflet + CARTO tiles via same-origin Pages proxies (works on blocked mobile CDNs). */
export function mapBootstrapHtml(extraHeadCss = ""): { head: string; tileLayerJs: string } {
  const origin = getMapAssetOrigin();
  return {
    head: `<base href="${origin}/"/>
<link rel="stylesheet" href="${origin}/map-assets/leaflet.css"/>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#e8e0d8}${extraHeadCss}</style>`,
    tileLayerJs: `L.tileLayer('${origin}/map-tiles/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap © CARTO'}).addTo(map);`,
  };
}

export function mapLeafletScript(): string {
  const origin = getMapAssetOrigin();
  return `<script src="${origin}/map-assets/leaflet.js"><\/script>`;
}
