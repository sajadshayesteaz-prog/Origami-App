import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelPackage, Step } from "@origami/engine";
import { deleteModel, fileUrl, loadLibrary, loadModel, saveImage, saveModel, type BookSummary } from "../player/library";

type Box = [number, number, number, number]; // x, y, w, h in page-render pixels

const pageFile = (p: number) => `_pages/${String(p).padStart(4, "0")}.jpg`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "model";

/**
 * Import review (task 003): fix the importer's step boxes on the book page.
 * Mouse: click a box to select, drag to move, drag the corner to resize, Shift+drag on the page to add.
 * Keys: Delete remove · S split (top/bottom) · Shift+S split (left/right) · M merge with next ·
 *       arrows nudge (Shift ×10) · [ ] previous/next page · Ctrl+S save.
 */
export function ReviewScreen() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [book, setBook] = useState("");
  const [modelId, setModelId] = useState("");
  const [model, setModel] = useState<ModelPackage | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [scale, setScale] = useState(1);
  const img = useRef<HTMLImageElement>(null);

  const reloadLibrary = useCallback(() => loadLibrary().then((b) => setBooks(b.filter((x) => x.slug !== "scripted"))), []);
  useEffect(() => void reloadLibrary(), [reloadLibrary]);
  useEffect(() => {
    if (!book || !modelId) return;
    loadModel(book, modelId).then((m) => {
      setModel(m);
      setDirty(new Set());
      setSelected(m.steps.length ? 0 : null);
      setPage(m.steps.find((s) => s.image?.page)?.image?.page ?? m.source?.pages?.[0] ?? 1);
    });
  }, [book, modelId]);

  const pages = useMemo(() => {
    if (!model) return [];
    const ps = model.steps.map((s) => s.image?.page).filter((p): p is number => !!p);
    const [a, b] = [Math.min(...ps, ...(model.source?.pages ?? [])), Math.max(...ps, ...(model.source?.pages ?? []))];
    return Number.isFinite(a) ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [];
  }, [model]);

  const update = (fn: (steps: Step[]) => Step[], touched: string[] = []) => {
    setModel((m) => (m ? { ...m, steps: fn(m.steps.map((s) => ({ ...s }))) } : m));
    setDirty((d) => new Set([...d, ...touched, "__model"]));
  };
  const setBox = (i: number, b: Box) =>
    update((steps) => {
      const s = steps[i];
      s.image = { ...(s.image ?? { file: `images/${s.id}.png`, page }), page: s.image?.page ?? page, bbox: b.map(Math.round) as Box };
      return steps;
    }, [model!.steps[i].id]);

  const onPage = (model?.steps ?? []).map((s, i) => [s, i] as const).filter(([s]) => s.image?.page === page && s.image?.bbox);

  // Pointer interactions on the page.
  const drag = useRef<{ mode: "move" | "resize" | "new"; i: number; start: [number, number]; box: Box } | null>(null);
  const toPage = (e: React.PointerEvent): [number, number] => {
    const r = img.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };
  const onPointerDown = (e: React.PointerEvent, i: number | null, mode: "move" | "resize" | "new") => {
    e.stopPropagation();
    const p = toPage(e);
    if (mode === "new") {
      if (!e.shiftKey || !model) return;
      const id = `s${Date.now().toString(36)}`;
      const at = selected === null ? model.steps.length : selected + 1;
      const label = String(Number(model.steps[at - 1]?.label ?? 0) + 1 || "?");
      update((steps) => (steps.splice(at, 0, { id, label, level: "L0", image: { file: `images/${id}.png`, page, bbox: [p[0], p[1], 1, 1] } }), steps), [id]);
      setSelected(at);
      drag.current = { mode: "resize", i: at, start: p, box: [p[0], p[1], 1, 1] };
    } else if (i !== null) {
      setSelected(i);
      drag.current = { mode, i, start: p, box: model!.steps[i].image!.bbox as Box };
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toPage(e);
    const [dx, dy] = [x - d.start[0], y - d.start[1]];
    const b = d.box;
    setBox(d.i, d.mode === "move" ? [b[0] + dx, b[1] + dy, b[2], b[3]] : [b[0], b[1], Math.max(8, b[2] + dx), Math.max(8, b[3] + dy)]);
  };

  const split = (i: number, vertical: boolean) =>
    update((steps) => {
      const s = steps[i];
      const [x, y, w, h] = s.image!.bbox as Box;
      const id = `${s.id}b`;
      const second: Step = { ...s, id, label: `${s.label}b`, image: { file: `images/${id}.png`, page: s.image!.page, bbox: vertical ? [x + w / 2, y, w / 2, h] : [x, y + h / 2, w, h / 2] } };
      s.image = { ...s.image!, bbox: vertical ? [x, y, w / 2, h] : [x, y, w, h / 2] };
      steps.splice(i + 1, 0, second);
      return steps;
    }, [model!.steps[i].id, `${model!.steps[i].id}b`]);
  const merge = (i: number) => {
    const a = model!.steps[i];
    const b = model!.steps[i + 1];
    if (!b || a.image?.page !== b.image?.page || !a.image?.bbox || !b.image?.bbox) return setStatus("Merge needs a next step on the same page.");
    const [ax, ay, aw, ah] = a.image.bbox;
    const [bx, by, bw, bh] = b.image.bbox;
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    update((steps) => {
      steps[i].image = { ...steps[i].image!, bbox: [x, y, Math.max(ax + aw, bx + bw) - x, Math.max(ay + ah, by + bh) - y] };
      steps[i].caption = { original: [a.caption?.original, b.caption?.original].filter(Boolean).join(" "), lang: "en" };
      steps[i].label = `${a.label}, ${b.label}`;
      steps.splice(i + 1, 1);
      return steps;
    }, [a.id]);
  };
  const remove = (i: number) => {
    update((steps) => (steps.splice(i, 1), steps));
    setSelected(Math.min(i, model!.steps.length - 2));
  };
  const moveStep = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= model!.steps.length) return;
    update((steps) => ([steps[i], steps[j]] = [steps[j], steps[i]], steps));
    setSelected(j);
  };

  /** Crops a step's box from its page render into a PNG. */
  const crop = async (s: Step): Promise<Blob> => {
    const im = new Image();
    im.src = fileUrl(book, pageFile(s.image!.page!));
    await im.decode();
    const [x, y, w, h] = s.image!.bbox!.map(Math.round);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(im, x, y, w, h, 0, 0, w, h);
    return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
  };

  const save = async (m = model!) => {
    setStatus("Saving…");
    for (const s of m.steps) if (dirty.has(s.id) && s.image?.bbox) await saveImage(book, m.id, s.image.file.replace(/^images\//, ""), await crop(s));
    await saveModel(book, m);
    setDirty(new Set());
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    reloadLibrary();
  };

  const newModelFromHere = async (i: number) => {
    const title = prompt("Title of the new model starting at this step:");
    if (!title || !model) return;
    const id = slugify(title);
    const rest = model.steps.slice(i);
    const first: ModelPackage = { ...model, steps: model.steps.slice(0, i) };
    const second: ModelPackage = { ...model, id, title, steps: rest, source: { ...model.source, pages: [rest[0].image?.page ?? page] } };
    await save(first);
    for (const s of rest) if (s.image?.bbox) await saveImage(book, id, s.image.file.replace(/^images\//, ""), await crop(s));
    await saveModel(book, second);
    setStatus(`Created ${id}`);
    await reloadLibrary();
    setModelId(id);
  };

  const removeModel = async () => {
    if (!model || !confirm(`Delete the package "${model.title}"? Its steps are lost.`)) return;
    await deleteModel(book, model.id);
    setModel(null);
    setModelId("");
    reloadLibrary();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!model || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const i = selected;
      if (e.key === "s" && e.ctrlKey) return e.preventDefault(), void save();
      if (e.key === "[") return setPage((p) => Math.max(pages[0] ?? p, p - 1));
      if (e.key === "]") return setPage((p) => Math.min(pages[pages.length - 1] ?? p, p + 1));
      if (i === null) return;
      const b = model.steps[i].image?.bbox as Box | undefined;
      const k = e.shiftKey ? 10 : 2;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] };
      if (nudge[e.key] && b) setBox(i, [b[0] + nudge[e.key][0], b[1] + nudge[e.key][1], b[2], b[3]]);
      else if (e.key === "Delete") remove(i);
      else if (e.key.toLowerCase() === "s") split(i, e.shiftKey);
      else if (e.key.toLowerCase() === "m") merge(i);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const models = books.find((b) => b.slug === book)?.models ?? [];
  const sel = selected !== null ? model?.steps[selected] : undefined;

  return (
    <section className="review">
      <div className="toolbar">
        <label>
          Book{" "}
          <select value={book} onChange={(e) => (setBook(e.target.value), setModelId(""))} data-testid="review-book">
            <option value="">—</option>
            {books.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model{" "}
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} data-testid="review-model">
            <option value="">—</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.steps})
              </option>
            ))}
          </select>
        </label>
        {model && (
          <>
            <label>
              Title <input value={model.title} onChange={(e) => (setModel({ ...model, title: e.target.value }), setDirty((d) => new Set([...d, "__model"])))} />
            </label>
            <button onClick={() => save()} disabled={!dirty.size} data-testid="review-save">
              Save{dirty.size ? " *" : ""}
            </button>
            <button onClick={removeModel}>Delete package</button>
            <span className="muted">{status}</span>
          </>
        )}
      </div>
      {!books.length && <div className="muted">No imported books yet. Run the importer (tools/import-book).</div>}
      {model && (
        <div className="review-layout">
          <div>
            <div className="stepper">
              <button onClick={() => setPage((p) => Math.max(pages[0], p - 1))}>[ Prev page</button>
              <span className="counter">Page {page}</span>
              <button onClick={() => setPage((p) => Math.min(pages[pages.length - 1], p + 1))}>Next page ]</button>
              <span className="muted">Shift+drag on the page adds a step.</span>
            </div>
            <div className="review-page" onPointerDown={(e) => onPointerDown(e, null, "new")} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
              <img
                ref={img}
                src={fileUrl(book, pageFile(page))}
                alt={`page ${page}`}
                draggable={false}
                onLoad={(e) => setScale(e.currentTarget.clientWidth / e.currentTarget.naturalWidth)}
              />
              {onPage.map(([s, i]) => {
                const [x, y, w, h] = s.image!.bbox!;
                return (
                  <div
                    key={s.id}
                    className={`review-box ${i === selected ? "selected" : ""}`}
                    style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale }}
                    onPointerDown={(e) => onPointerDown(e, i, "move")}
                    data-testid={`box-${s.id}`}
                  >
                    <span className="review-label">{s.label}</span>
                    <span className="review-handle" onPointerDown={(e) => onPointerDown(e, i, "resize")} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="review-side">
            {sel && selected !== null && (
              <div className="review-edit">
                <label>
                  Label <input value={sel.label} onChange={(e) => update((st) => ((st[selected].label = e.target.value), st))} />
                </label>
                <label>
                  Caption
                  <textarea
                    value={sel.caption?.original ?? ""}
                    onChange={(e) => update((st) => ((st[selected].caption = { original: e.target.value, lang: "en" }), st))}
                  />
                </label>
                <div className="toolbar">
                  <button onClick={() => split(selected, false)}>Split ⬍ (S)</button>
                  <button onClick={() => split(selected, true)}>Split ⬌ (⇧S)</button>
                  <button onClick={() => merge(selected)}>Merge next (M)</button>
                  <button onClick={() => moveStep(selected, -1)}>Up</button>
                  <button onClick={() => moveStep(selected, 1)}>Down</button>
                  <button onClick={() => remove(selected)}>Delete (Del)</button>
                  <button onClick={() => newModelFromHere(selected)}>New model from here</button>
                </div>
              </div>
            )}
            <ol className="review-steps">
              {model.steps.map((s, i) => (
                <li key={s.id} className={i === selected ? "current" : ""}>
                  <button className="link" onClick={() => (setSelected(i), s.image?.page && setPage(s.image.page))}>
                    <b>{s.label}</b> <span className="muted">p{s.image?.page}</span> {s.caption?.original?.slice(0, 60)}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
