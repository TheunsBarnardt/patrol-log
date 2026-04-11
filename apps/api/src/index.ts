// Cloudflare Workers entry point.
// Routes are FDL-driven; see blueprints/*/*.blueprint.yaml

import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppContext } from "./lib/middleware.js";
import { corsMiddleware, errorHandler } from "./lib/middleware.js";
import { auth } from "./routes/auth.js";
import { patrolRoutes } from "./routes/patrols.js";
import { hotspots } from "./routes/hotspots.js";
import { directory } from "./routes/directory.js";
import { liveMap } from "./routes/live-map.js";
import { admin } from "./routes/admin.js";
import { vehiclesRoute } from "./routes/vehicles.js";
import { sectorsRoute } from "./routes/sectors.js";
import { pushTokensRoute, messagesRoute, adminMessagesRoute } from "./routes/messages.js";

const app = new Hono<AppContext>();

app.use("*", logger());
app.use("*", corsMiddleware());
app.onError(errorHandler);

app.get("/", (c) => c.json({ name: c.env.APP_NAME ?? "Patrol Log API", env: c.env.ENV ?? "dev", ok: true }));
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.route("/auth", auth);
app.route("/patrols", patrolRoutes);
app.route("/hotspots", hotspots);
app.route("/directory", directory);
app.route("/live-map", liveMap);
app.route("/admin", admin);
app.route("/vehicles", vehiclesRoute);
app.route("/admin", sectorsRoute);        // adds /admin/sectors
app.route("/push-tokens", pushTokensRoute);
app.route("/messages", messagesRoute);
app.route("/admin/messages", adminMessagesRoute);

export default app;
