import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "weights", "needle3.cact");
const url = "https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact";

try {
  const info = await stat(file);
  if (info.size > 20_000_000) process.exit(0);
} catch {
  // download below
}

await mkdir(path.dirname(file), { recursive: true });
process.stdout.write("Downloading Needle 3 weights…\n");
const res = await fetch(url);
if (!res.ok || !res.body) {
  process.stderr.write("Could not download Needle 3 weights.\n");
  process.exit(1);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
