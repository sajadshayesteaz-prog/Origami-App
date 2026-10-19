// Runs the Python importer in its venv (created by tools/import-book/setup.bat).
// Usage: npm run import:book -- <book-slug> [--pages 15-40] [--debug <dir>] [--no-cache]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const venv = process.env.ORIGAMI_VENV ?? join(process.env.LOCALAPPDATA ?? "", "origami-app", "venv");
const python = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error(`Python venv not found at ${venv}. Run tools/import-book/setup.bat first.`);
  process.exit(1);
}
const r = spawnSync(python, ["-I", join(here, "import_book.py"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
