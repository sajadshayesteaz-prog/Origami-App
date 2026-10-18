// Copy sample crease patterns from the comms repo into app/public/samples/ and write an index.
// Usage: npm run sync:samples   (COMMS_DIR from .env, default ../Claude-Code-for-origami)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { copyRecursive } from "./fsutil.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const commsDir = resolve(root, env.match(/^COMMS_DIR=(.*)$/m)?.[1]?.trim() || "../Claude-Code-for-origami");
const src = join(commsDir, "sources", "samples");
const dst = join(root, "app", "public", "samples");

if (!existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter((f) => /\.(fold|svg)$/i.test(f)).sort();
for (const f of files) copyRecursive(join(src, f), join(dst, f));
writeFileSync(join(dst, "index.json"), JSON.stringify(files, null, 2) + "\n");
console.log(`Copied ${files.length} samples to ${dst}`);
