// Cloudflare Worker environment bindings.
// JWT_SECRET comes from `wrangler secret` in production,
// and `.dev.vars` in local development.
// DB is a D1 database binding configured in wrangler.toml.

import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  ENV?: string;
  APP_NAME?: string;
}

export type AuthenticatedContext = {
  patroller: {
    patroller_id: string;
    call_sign: string;
    access_level: "call_centre_agent" | "patroller" | "sector_lead" | "admin";
    cpf_id: string;
    sector_id: string;
  };
  device: {
    device_id: string;
    device_token_jti: string;
  };
  ip: string;
};
