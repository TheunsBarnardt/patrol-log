/**
 * Proxy CARTO/OSM raster tiles through Pages — same-origin for mobile carriers.
 * /map-tiles/{z}/{x}/{y}.png
 */

type PagesContext = {
  request: Request;
  params: { path?: string | string[] };
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const parts = context.params.path;
  const path = Array.isArray(parts) ? parts.join("/") : parts ? String(parts) : "";
  if (!/^\d+\/\d+\/\d+(\.png)?$/.test(path)) {
    return new Response("Bad tile path", { status: 400 });
  }
  const clean = path.endsWith(".png") ? path : `${path}.png`;
  // Use a fixed subdomain — proxy doesn't need round-robin.
  const target = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${clean}`;

  try {
    const upstream = await fetch(target, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit);
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") ?? "image/png");
    headers.set("cache-control", "public, max-age=86400");
    headers.set("access-control-allow-origin", "*");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    return Response.json(
      { error: "MAP_TILE_UNAVAILABLE", message: err?.message ?? String(err), target },
      { status: 502 },
    );
  }
}
