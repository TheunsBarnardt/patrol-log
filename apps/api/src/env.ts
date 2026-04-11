// Cloudflare Worker environment bindings.
// DATABASE_URL and JWT_SECRET come from `wrangler secret` in production,
// and `.dev.vars` in local development.

export interface Env {
  DATABASE_URL: string;
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
