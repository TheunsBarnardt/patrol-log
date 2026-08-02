import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@patrol-log/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: { port: 5173 },
  // VITE_* variables are loaded automatically from .env by Vite.
  // Set VITE_API_BASE_URL=.env.local for local development.
});
