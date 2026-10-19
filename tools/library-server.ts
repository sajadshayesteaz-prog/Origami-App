// Dev-server plugin: serves Model Packages to the player and lets the review screen save edits.
// Local personal app only — the write endpoints exist in `vite dev`, never in a build.
//
// Libraries:
//   "scripted" → data/library/<id>/              (hand-made packages, committed)
//   <book>     → $ORIGAMI_LIBRARY_OUT/<book>/<id>/ (imported books, not committed)
//                plus <book>/book.json and <book>/_pages/NNNN.jpg (page renders for review)
//
// GET  /api/library                      → books and their models (summary)
// GET  /api/library/:book/:id            → model.json
// PUT  /api/library/:book/:id            → write model.json (JSON body)
// DELETE /api/library/:book/:id          → delete a model package folder
// GET  /files/:book/<path>               → any file inside the book folder (images, pages)
// PUT  /files/:book/:id/images/:name     → write an image (raw body)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(): Record<string, string> {
  const p = join(root, ".env");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Folder with imported book packages: ORIGAMI_LIBRARY_OUT, else $ORIGAMI_LIBRARY_DIR/library. */
export function libraryOut(): string | null {
  const env = { ...readEnv(), ...process.env };
  if (env.ORIGAMI_LIBRARY_OUT) return resolve(root, env.ORIGAMI_LIBRARY_OUT);
  if (env.ORIGAMI_LIBRARY_DIR) return join(env.ORIGAMI_LIBRARY_DIR, "library");
  return null;
}

const SAFE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/; // no leading dot, so no ".."

function bookDir(book: string): string | null {
  if (!SAFE.test(book)) return null;
  if (book === "scripted") return join(root, "data", "library");
  const out = libraryOut();
  return out ? join(out, book) : null;
}

function listBooks() {
  const books: { slug: string; title: string; models: unknown[] }[] = [];
  const add = (slug: string, title: string, dir: string) => {
    if (!existsSync(dir)) return;
    const models = readdirSync(dir)
      .filter((id) => SAFE.test(id) && existsSync(join(dir, id, "model.json")))
      .map((id) => {
        try {
          const m = JSON.parse(readFileSync(join(dir, id, "model.json"), "utf8"));
          const levels: Record<string, number> = { L0: 0, L1: 0, L2: 0 };
          for (const s of m.steps ?? []) levels[s.level] = (levels[s.level] ?? 0) + 1;
          return { id, title: m.title, difficulty: m.difficulty ?? null, steps: (m.steps ?? []).length, levels, order: m.source?.pages?.[0] ?? 0 };
        } catch (e) {
          return { id, title: `${id} (unreadable: ${(e as Error).message})`, difficulty: null, steps: 0, levels: {}, order: 0 };
        }
      })
      .sort((a, b) => a.order - b.order || String(a.title).localeCompare(String(b.title)));
    books.push({ slug, title, models });
  };
  add("scripted", "Scripted (engine)", join(root, "data", "library"));
  const out = libraryOut();
  if (out && existsSync(out))
    for (const slug of readdirSync(out)) {
      const dir = join(out, slug);
      if (!SAFE.test(slug) || !statSync(dir).isDirectory()) continue;
      const meta = existsSync(join(dir, "book.json")) ? JSON.parse(readFileSync(join(dir, "book.json"), "utf8")) : {};
      add(slug, meta.title ?? slug, dir);
    }
  return books;
}

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".svg": "image/svg+xml", ".fold": "application/json" };

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

function send(res: ServerResponse, code: number, data: unknown, type = "application/json") {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(type === "application/json" ? JSON.stringify(data) : (data as Buffer));
}

export function libraryServer(): Plugin {
  return {
    name: "origami-library",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        try {
          if (url === "/api/library" && req.method === "GET") return send(res, 200, { books: listBooks(), out: libraryOut() });
          let m = /^\/api\/library\/([^/]+)\/([^/]+)$/.exec(url);
          if (m) {
            const dir = bookDir(m[1]);
            if (!dir || !SAFE.test(m[2])) return send(res, 400, { error: "bad path" });
            const file = join(dir, m[2], "model.json");
            if (req.method === "GET") return existsSync(file) ? send(res, 200, JSON.parse(readFileSync(file, "utf8"))) : send(res, 404, { error: "not found" });
            if (req.method === "PUT") {
              const model = JSON.parse((await body(req)).toString("utf8"));
              if (model.format !== "origami-model-package/1" || model.id !== m[2]) return send(res, 400, { error: "not a model package for this id" });
              mkdirSync(dirname(file), { recursive: true });
              writeFileSync(file, JSON.stringify(model, null, 2) + "\n");
              return send(res, 200, { ok: true });
            }
            if (req.method === "DELETE") {
              if (m[1] === "scripted") return send(res, 403, { error: "scripted packages are edited in git" });
              rmSync(join(dir, m[2]), { recursive: true, force: true });
              return send(res, 200, { ok: true });
            }
          }
          m = /^\/files\/([^/]+)\/(.+)$/.exec(url);
          if (m) {
            const dir = bookDir(m[1]);
            const parts = m[2].split("/");
            if (!dir || !parts.every((p) => SAFE.test(p))) return send(res, 400, { error: "bad path" });
            const file = join(dir, ...parts);
            if (req.method === "GET") {
              if (!existsSync(file)) return send(res, 404, { error: "not found" });
              return send(res, 200, readFileSync(file), TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
            }
            if (req.method === "PUT" && parts.length === 3 && parts[1] === "images") {
              mkdirSync(dirname(file), { recursive: true });
              writeFileSync(file, await body(req));
              return send(res, 200, { ok: true });
            }
          }
        } catch (e) {
          return send(res, 500, { error: (e as Error).message });
        }
        next();
      });
    },
  };
}
