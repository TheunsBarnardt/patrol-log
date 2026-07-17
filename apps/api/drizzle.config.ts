import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  // D1 uses a database name; for local dev with wrangler, we use a local SQLite file
  dbCredentials: {
    url: "file:../d1-local.db",
  },
  verbose: true,
  strict: true,
} satisfies Config;
