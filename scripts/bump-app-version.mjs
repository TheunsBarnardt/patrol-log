/**
 * Bump patch version for mobile or admin before deploy.
 * Usage: node scripts/bump-app-version.mjs mobile|admin
 *
 * Skip with SKIP_VERSION_BUMP=1
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const target = process.argv[2];

if (process.env.SKIP_VERSION_BUMP === "1") {
  console.log("[bump] skipped (SKIP_VERSION_BUMP=1)");
  process.exit(0);
}

if (target !== "mobile" && target !== "admin") {
  console.error("Usage: node scripts/bump-app-version.mjs mobile|admin");
  process.exit(1);
}

function bumpPatch(version) {
  const parts = String(version).split(".").map((n) => Number(n));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid version: ${version}`);
  }
  parts[2] += 1;
  return parts.join(".");
}

const appDir = join(root, "apps", target);
const pkgPath = join(appDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = bumpPatch(pkg.version);
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (target === "mobile") {
  const appJsonPath = join(appDir, "app.json");
  const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
  appJson.expo.version = next;
  writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  const versionTsPath = join(appDir, "src", "version.ts");
  writeFileSync(
    versionTsPath,
    `import Constants from "expo-constants";

/** Bump with \`app.json\` / \`package.json\` version so About shows deploy freshness. */
export const APP_VERSION =
  Constants.expoConfig?.version ??
  Constants.nativeAppVersion ??
  "${next}";

export const APP_NAME = "Patrol Log";
`,
  );
}

if (target === "admin") {
  const versionTsPath = join(appDir, "src", "version.ts");
  writeFileSync(
    versionTsPath,
    `/** Bump when shipping admin - shown in the sidebar About line. */
export const APP_VERSION = "${next}";
export const APP_NAME = "Patrol Log Admin";
`,
  );
}

console.log(`[bump] @patrol-log/${target} → v${next}`);
