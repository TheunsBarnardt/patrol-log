/**
 * Proxy OpenStreetMap raster tiles through Pages — same-origin for mobile carriers.
 * /map-tiles/{z}/{x}/{y}.png
 *
 * OSM tile usage: identify the app, cache, and do not scrape. No API key.
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
  const target = `https://tile.openstreetmap.org/${clean}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
        "User-Agent": "PatrolLog/1.0 (https://patrol-log-mobile.pages.dev; map tile proxy)",
      },
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
