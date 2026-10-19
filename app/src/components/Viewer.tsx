import { useCallback, useEffect, useMemo, useState } from "react";
import { parseFoldDoc, type FoldDoc } from "../lib/foldDoc";
import { CreasePattern2D } from "./CreasePattern2D";
import { Simulator3D, type SimInput } from "./Simulator3D";

const SAMPLES_URL = `${import.meta.env.BASE_URL}samples/`;
const DEFAULT_SAMPLE = "crane-sequence.fold";

/** Legacy FOLD/SVG viewer from task 001: crease pattern + Origami Simulator (physics view). */
export function Viewer() {
  const [samples, setSamples] = useState<string[]>([]);
  const [doc, setDoc] = useState<FoldDoc | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((name: string, text: string) => {
    try {
      setDoc(parseFoldDoc(name, text));
      setIndex(0);
      setError(null);
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`);
    }
  }, []);

  const openSample = useCallback(
    async (name: string) => {
      const res = await fetch(SAMPLES_URL + name);
      open(name, await res.text());
    },
    [open],
  );

  useEffect(() => {
    fetch(SAMPLES_URL + "index.json")
      .then((r) => r.json())
      .then(setSamples)
      .catch(() => setSamples([]));
    openSample(DEFAULT_SAMPLE);
  }, [openSample]);

  const count = doc?.frames.length ?? 0;
  const go = useCallback((delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(count - 1, 0))), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(Math.max(count - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, count]);

  const frame = doc?.frames[index] ?? null;
  const simInput = useMemo<SimInput | null>(() => {
    if (!doc || !frame) return null;
    return doc.source.kind === "svg"
      ? { kind: "svg", svg: doc.source.svg, filename: doc.name }
      : { kind: "fold", frame, title: doc.title };
  }, [doc, frame]);

  return (
    <section className="viewer">
      <div className="toolbar">
        <label>
          Sample:{" "}
          <select value={samples.includes(doc?.name ?? "") ? doc!.name : ""} onChange={(e) => e.target.value && openSample(e.target.value)}>
            <option value="">Choose a sample…</option>
            {samples.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="file-button">
          Open file <bdi dir="ltr">(.fold / .svg)</bdi>
          <input
            type="file"
            accept=".fold,.svg,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) open(file.name, await file.text());
              e.target.value = "";
            }}
          />
        </label>
        {doc && <span className="doc-title">{doc.title}</span>}
      </div>

      {error && <div className="error">Could not read file — {error}</div>}
      {!doc && !error && <div className="hint">Choose a sample or open a file.</div>}

      <div className="stepper">
        <button onClick={() => go(-1)} disabled={index <= 0}>
          Previous
        </button>
        <span className="counter" data-testid="frame-counter">
          Step {count ? index + 1 : 0} of {count}
        </span>
        <button onClick={() => go(1)} disabled={index >= count - 1}>
          Next
        </button>
        <span className="hint">Arrow keys: previous / next step</span>
      </div>

      <div className="views">
        <CreasePattern2D frame={frame} />
        <Simulator3D input={simInput} />
      </div>
    </section>
  );
}
