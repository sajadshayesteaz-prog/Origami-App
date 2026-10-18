import { useCallback, useEffect, useMemo, useState } from "react";
import { parseFoldDoc, type FoldDoc } from "../lib/foldDoc";
import { formatNumber, useT, type Lang } from "../i18n";
import { CreasePattern2D } from "./CreasePattern2D";
import { Simulator3D, type SimInput } from "./Simulator3D";

const SAMPLES_URL = `${import.meta.env.BASE_URL}samples/`;
const DEFAULT_SAMPLE = "crane-sequence.fold";

export function Viewer({ lang }: { lang: Lang }) {
  const t = useT();
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

  // Arrow keys follow reading direction: in RTL (fa) the next step is to the left.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const forward = lang === "fa" ? "ArrowLeft" : "ArrowRight";
      const back = lang === "fa" ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward || e.key === "PageDown") go(1);
      else if (e.key === back || e.key === "PageUp") go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(Math.max(count - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, lang, count]);

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
          {t("sample")}:{" "}
          <select value={samples.includes(doc?.name ?? "") ? doc!.name : ""} onChange={(e) => e.target.value && openSample(e.target.value)}>
            <option value="">{t("chooseSample")}</option>
            {samples.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="file-button">
          {t("openFile")} <bdi dir="ltr">(.fold / .svg)</bdi>
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

      {error && <div className="error">{t("loadError")} — {error}</div>}
      {!doc && !error && <div className="hint">{t("noFile")}</div>}

      <div className="stepper">
        <button onClick={() => go(-1)} disabled={index <= 0}>
          {t("prev")}
        </button>
        <span className="counter" data-testid="frame-counter">
          {t("frame")} {formatNumber(count ? index + 1 : 0, lang)} {t("of")} {formatNumber(count, lang)}
        </span>
        <button onClick={() => go(1)} disabled={index >= count - 1}>
          {t("next")}
        </button>
        <span className="hint">{t("keyboardHint")}</span>
      </div>

      <div className="views">
        <CreasePattern2D frame={frame} />
        <Simulator3D input={simInput} />
      </div>
    </section>
  );
}
