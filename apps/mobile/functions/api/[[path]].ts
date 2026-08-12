/**
 * Same-origin API proxy.
 * Some SA mobile networks time out on *.workers.dev while *.pages.dev works.
 * Browser calls /api/* on this Pages host; we forward to the Worker.
 */

const UPSTREAM = "https://patrol-log-api.small-night-657e.workers.dev";

type PagesContext = {
  request: Request;
  params: { path?: string | string[] };
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);
  const parts = context.params.path;
  const suffix = Array.isArray(parts) ? parts.join("/") : parts ? String(parts) : "";
  const target = `${UPSTREAM}/${suffix}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-patrol-log-proxy", "pages");

  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: "manual",
  };

  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
    // Required when streaming a request body in the Workers runtime.
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }

  try {
    const upstream = await fetch(target, init);
    const outHeaders = new Headers(upstream.headers);
    // Ensure browsers don't cache error/auth responses oddly through the proxy.
    if (!outHeaders.has("cache-control")) {
      outHeaders.set("cache-control", "no-store");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err: any) {
    return Response.json(
      {
        error: "API_UNAVAILABLE",
        message: `Proxy failed: ${err?.message ?? String(err)}`,
        target,
      },
      { status: 502 },
    );
  }
}
