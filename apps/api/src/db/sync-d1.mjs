/**
 * Sync operational data between Cloudflare D1 (remote) and local D1.
 * Never touches system_backups. Intended for system admins only.
 *
 *   pnpm db:sync:pull          # Cloudflare → local
 *   pnpm db:sync:push -- --yes # local → Cloudflare (destructive)
 */
import { writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(__dirname, "../..");
const DB = "patrol-log-db";

const WIPE_TABLES = [
  "message_channel_members",
  "message_reads",
  "messages",
  "message_channels",
  "push_tokens",
  "audit_log",
  "patrol_escalation_events",
  "patrol_breadcrumbs",
  "patrol_members",
  "live_pins",
  "patrols",
  "devices",
  "login_attempts",
  "next_of_kin",
  "hotspots",
  "incidents",
  "emergency_services",
  "residents",
  "vehicles",
  "patrollers",
  "sectors",
  "cpfs",
];

const INSERT_TABLES = [
  "cpfs",
  "sectors",
  "patrollers",
  "next_of_kin",
  "devices",
  "login_attempts",
  "vehicles",
  "patrols",
  "patrol_members",
  "patrol_breadcrumbs",
  "patrol_escalation_events",
  "live_pins",
  "residents",
  "emergency_services",
  "hotspots",
  "incidents",
  "audit_log",
  "push_tokens",
  "message_channels",
  "messages",
  "message_reads",
  "message_channel_members",
];

function runWrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`wrangler ${args.join(" ")} failed (${result.status})`);
  }
  return result.stdout;
}

function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function dumpTables(remote) {
  const flag = remote ? "--remote" : "--local";
  const tables = {};
  for (const name of INSERT_TABLES) {
    process.stdout.write(`[sync] dump ${name} (${remote ? "remote" : "local"})… `);
    const out = runWrangler([
      "d1",
      "execute",
      DB,
      flag,
      "--json",
      "--command",
      `SELECT * FROM ${name}`,
    ]);
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error(`Failed to parse JSON for ${name}: ${out.slice(0, 200)}`);
    }
    const rows = parsed?.[0]?.results ?? parsed?.results ?? [];
    tables[name] = Array.isArray(rows) ? rows : [];
    console.log(`${tables[name].length} rows`);
  }
  return tables;
}

function buildRestoreSql(tables) {
  let sql = `-- sync-d1 generated — system_backups NOT touched\n`;
  for (const name of WIPE_TABLES) {
    sql += `DELETE FROM ${name};\n`;
  }
  for (const name of INSERT_TABLES) {
    const rows = tables[name] ?? [];
    for (const row of rows) {
      const cols = Object.keys(row);
      if (!cols.length) continue;
      const vals = cols.map((c) => sqlLiteral(row[c]));
      sql += `INSERT INTO ${name} (${cols.join(",")}) VALUES (${vals.join(",")});\n`;
    }
  }
  return sql;
}

function applySql(sql, remote) {
  const flag = remote ? "--remote" : "--local";
  const file = join(tmpdir(), `patrol-log-sync-${Date.now()}.sql`);
  writeFileSync(file, sql, "utf8");
  try {
    console.log(`[sync] applying to ${remote ? "Cloudflare (remote)" : "local"}…`);
    runWrangler(["d1", "execute", DB, flag, `--file=${file}`]);
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

function parseArgs(argv) {
  const direction = argv[2]; // pull | push
  const yes = argv.includes("--yes") || argv.includes("-y");
  return { direction, yes };
}

async function main() {
  const { direction, yes } = parseArgs(process.argv);
  if (direction !== "pull" && direction !== "push") {
    console.error(`Usage:
  node src/db/sync-d1.mjs pull          # Cloudflare → local
  node src/db/sync-d1.mjs push --yes    # local → Cloudflare (requires --yes)
`);
    process.exit(1);
  }

  console.log("[sync] System-admin D1 sync. system_backups is never modified.");
  if (direction === "pull") {
    console.log("[sync] Direction: Cloudflare (remote) → local");
    const tables = dumpTables(true);
    applySql(buildRestoreSql(tables), false);
    console.log("[sync] Done. Local D1 now matches Cloudflare operational data.");
    return;
  }

  // push
  if (!yes) {
    console.error(
      "[sync] Refusing to push to Cloudflare without --yes\n" +
        "  This REPLACES remote operational data with local.\n" +
        "  Run: pnpm db:sync:push -- --yes",
    );
    process.exit(1);
  }
  console.log("[sync] Direction: local → Cloudflare (remote) — DESTRUCTIVE");
  const tables = dumpTables(false);
  applySql(buildRestoreSql(tables), true);
  console.log("[sync] Done. Cloudflare D1 now matches local operational data.");
}

main().catch((err) => {
  console.error("[sync] failed:", err.message || err);
  process.exit(1);
});
