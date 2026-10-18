// Copy a trimmed Origami Simulator build from vendor/ into app/public/origami-simulator/
// and patch its index.html for embedding (no analytics, embed shim, no demo model).
// Usage: npm run sync:simulator   (requires vendor/OrigamiSimulator from fetch-sources.sh)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyRecursive } from "./fsutil.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "vendor", "OrigamiSimulator");
const dst = join(root, "app", "public", "origami-simulator");
const shim = join(root, "tools", "simulator-embed");

if (!existsSync(src)) {
  console.error(`Missing ${src}. Run: bash "$COMMS_DIR/sources/fetch-sources.sh" vendor`);
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(join(dst, "assets"), { recursive: true });

for (const dir of ["js", "css", "dependencies", "fonts"]) {
  copyRecursive(join(src, dir), join(dst, dir));
}
for (const file of ["LICENSE", "favicon.ico"]) {
  copyRecursive(join(src, file), join(dst, file));
}
// Only the small UI images at the top of assets/; the demo models and docs are not needed.
for (const name of readdirSync(join(src, "assets"))) {
  const p = join(src, "assets", name);
  if (statSync(p).isFile()) copyRecursive(p, join(dst, "assets", name));
}
for (const name of readdirSync(shim)) {
  copyRecursive(join(shim, name), join(dst, name));
}

let html = readFileSync(join(src, "index.html"), "utf8");
// Drop Google Analytics; the simulator still calls gtag(), so keep a no-op stub.
html = html.replace(
  /\s*<script async src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/,
  "\n    <script>window.gtag = function () {};</script>\n",
);
html = html.replace("</head>", '    <link rel="stylesheet" type="text/css" href="embed.css"/>\n</head>');
html = html.replace(
  '<script type="text/javascript" src="js/main.js"></script>',
  '<script type="text/javascript" src="js/main.js"></script>\n    <script type="text/javascript" src="embed.js"></script>',
);
if (!html.includes("embed.js") || html.includes("googletagmanager")) {
  console.error("Failed to patch OrigamiSimulator index.html");
  process.exit(1);
}
writeFileSync(join(dst, "index.html"), html);
console.log(`Origami Simulator copied to ${dst}`);
