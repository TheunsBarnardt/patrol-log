/**
 * Proxy Leaflet assets from unpkg through Pages so mobile data only hits pages.dev.
 * /map-assets/leaflet.css → unpkg leaflet css
 * /map-assets/leaflet.js → unpkg leaflet js
 */

const UNPKG = "https://unpkg.com/leaflet@1.9.4/dist";

type PagesContext = {
  request: Request;
  params: { path?: string | string[] };
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const parts = context.params.path;
  const file = Array.isArray(parts) ? parts.join("/") : parts ? String(parts) : "";
  if (!file || file.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const target = `${UNPKG}/${file}`;
  try {
    const upstream = await fetch(target, {
      headers: { Accept: context.request.headers.get("Accept") ?? "*/*" },
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit);
    const headers = new Headers(upstream.headers);
    headers.set("cache-control", "public, max-age=86400");
    headers.set("access-control-allow-origin", "*");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    return Response.json(
      { error: "MAP_ASSET_UNAVAILABLE", message: err?.message ?? String(err), target },
      { status: 502 },
    );
  }
}
