import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function needleWeights(): Plugin {
  const file = path.resolve(__dirname, "weights/needle3.cact");
  return {
    name: "needle-weights",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/needle3.cact") return next();
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end("Needle weights missing. Run pnpm --filter @patrol-log/admin dev again to download them.");
          return;
        }
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("cache-control", "public, max-age=604800");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), needleWeights()],
  optimizeDeps: { exclude: ["needle-rs"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@patrol-log/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, "") || "/",
      },
    },
  },
  // VITE_* is not used for the API base. Production always calls same-origin /api.
});
