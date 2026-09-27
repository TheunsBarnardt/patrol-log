// Cloudflare Worker environment bindings.
// JWT_SECRET comes from `wrangler secret` in production,
// and `.dev.vars` in local development.
// DB is a D1 database binding configured in wrangler.toml.

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  /** Needle 3 weights. The file is larger than a Pages asset, so it is served from R2. */
  NEEDLE?: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  ENV?: string;
  APP_NAME?: string;
}

export type AuthenticatedContext = {
  patroller: {
    patroller_id: string;
    call_sign: string;
    access_level: "call_centre_agent" | "patroller" | "sector_lead" | "admin" | "system_admin";
    cpf_id: string;
    sector_id: string;
  };
  device: {
    device_id: string;
    device_token_jti: string;
  };
  ip: string;
};
