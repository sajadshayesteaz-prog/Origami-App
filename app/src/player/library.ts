import type { ModelPackage } from "@origami/engine";

/** Library as served by tools/library-server.ts (dev server). */
export interface ModelSummary {
  id: string;
  title: string;
  difficulty: { scale: string; value: number } | null;
  steps: number;
  levels: Record<string, number>;
}
export interface BookSummary {
  slug: string;
  title: string;
  models: ModelSummary[];
}

// Fallback for builds without the dev server: the committed scripted packages only.
const bundled = import.meta.glob<ModelPackage>("../../../data/library/*/model.json", { eager: true, import: "default" });

export async function loadLibrary(): Promise<BookSummary[]> {
  try {
    const r = await fetch("/api/library");
    if (r.ok) return (await r.json()).books;
  } catch {
    /* no dev server */
  }
  const models = Object.values(bundled).map((m) => {
    const levels: Record<string, number> = {};
    for (const s of m.steps) levels[s.level] = (levels[s.level] ?? 0) + 1;
    return { id: m.id, title: m.title, difficulty: m.difficulty ?? null, steps: m.steps.length, levels };
  });
  return [{ slug: "scripted", title: "Scripted (engine)", models }];
}

export async function loadModel(book: string, id: string): Promise<ModelPackage> {
  try {
    const r = await fetch(`/api/library/${book}/${id}`);
    if (r.ok) return r.json();
  } catch {
    /* fall through */
  }
  const m = Object.values(bundled).find((p) => p.id === id);
  if (!m) throw new Error(`model ${book}/${id} not found`);
  return m;
}

export const fileUrl = (book: string, path: string) => `/files/${book}/${path.split("/").map(encodeURIComponent).join("/")}`;

export async function saveModel(book: string, model: ModelPackage) {
  const r = await fetch(`/api/library/${book}/${model.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) });
  if (!r.ok) throw new Error(`save failed: ${(await r.json()).error}`);
}

export async function deleteModel(book: string, id: string) {
  const r = await fetch(`/api/library/${book}/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`delete failed: ${(await r.json()).error}`);
}

export async function saveImage(book: string, id: string, name: string, blob: Blob) {
  const r = await fetch(fileUrl(book, `${id}/images/${name}`), { method: "PUT", body: blob });
  if (!r.ok) throw new Error(`image save failed: ${(await r.json()).error}`);
}

/** Difficulty for the list: stars for star scales, "Level n" for level scales. */
export const stars = (d: ModelSummary["difficulty"]) => {
  if (!d) return "";
  if (/level/i.test(d.scale)) return `Level ${d.value}`;
  return "★".repeat(Math.max(0, Math.round(d.value)));
};
