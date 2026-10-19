import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runPackage, type ModelPackage, type RunResult } from "@origami/engine";
import { Fold3D } from "./Fold3D";

// Model Packages are data files in data/library/<id>/; images sit next to model.json.
const models = import.meta.glob<ModelPackage>("../../../data/library/*/model.json", { eager: true, import: "default" });
const images = import.meta.glob<string>("../../../data/library/*/images/*", { eager: true, import: "default", query: "?url" });
const packages = Object.entries(models)
  .map(([path, pkg]) => ({ dir: path.replace(/model\.json$/, ""), pkg }))
  .sort((a, b) => a.pkg.title.localeCompare(b.pkg.title));

const MOTION_MS = 1200;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

export function Player() {
  const [pkgIndex, setPkgIndex] = useState(() => Math.max(0, packages.findIndex((p) => p.pkg.id === "bird-base")));
  const { pkg, dir } = packages[pkgIndex];
  const run: RunResult = useMemo(() => runPackage(pkg), [pkg]);
  const count = run.steps.length;

  // Step index; t runs 0..1 across all motions of the step (one segment per action).
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const anim = useRef<number | null>(null);

  const stop = () => {
    if (anim.current != null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  const play = useCallback((segments: number) => {
    stop();
    const t0 = performance.now();
    const total = MOTION_MS * Math.max(1, segments);
    const tick = () => {
      const u = Math.min((performance.now() - t0) / total, 1);
      setT(u);
      anim.current = u < 1 ? requestAnimationFrame(tick) : null;
    };
    setT(0);
    anim.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => stop, []);

  const step = run.steps[Math.min(index, count - 1)];
  const go = useCallback(
    (target: number, animate: boolean) => {
      const i = Math.min(Math.max(target, 0), count - 1);
      setIndex(i);
      if (animate) play(run.steps[i].motions.length);
      else {
        stop();
        setT(1);
      }
    },
    [count, play, run],
  );

  useEffect(() => {
    setIndex(0);
    stop();
    setT(1);
    setResetKey((k) => k + 1);
  }, [pkg]);

  // Simulated motions (collapse) are computed on first use; prepare the next step's while idle.
  useEffect(() => {
    const id = setTimeout(() => run.steps[index + 1]?.motions.forEach((m) => m.frame(0.5)), 400);
    return () => clearTimeout(id);
  }, [run, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(index + 1, index + 1 < count);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(index - 1, false);
      else if (e.key === "Home") go(0, false);
      else if (e.key === "End") go(count - 1, false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, count]);

  // Which motion segment t falls in, and the local time inside it.
  const n = step.motions.length;
  const seg = Math.min(Math.floor(t * n), n - 1);
  const localT = ease(Math.min(1, t * n - seg));
  const motion = step.motions[seg];
  const image = step.step.image ? images[`${dir}${step.step.image.file}`] : undefined;
  const colorUp = pkg.paper.colorUp ?? "#ffffff";
  const colorDown = pkg.paper.colorDown ?? "#e8758f";

  return (
    <section className="player">
      <div className="toolbar">
        <label>
          Model:{" "}
          <select value={pkgIndex} onChange={(e) => setPkgIndex(Number(e.target.value))} data-testid="model-select">
            {packages.map((p, i) => (
              <option key={p.pkg.id} value={i}>
                {p.pkg.title}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{pkg.designer}</span>
      </div>

      <div className="stepper">
        <button onClick={() => go(0, false)} disabled={index === 0}>
          Home
        </button>
        <button onClick={() => go(index - 1, false)} disabled={index === 0}>
          Previous
        </button>
        <span className="counter" data-testid="step-counter">
          Step {step.step.label} ({index + 1} of {count})
        </span>
        <button onClick={() => go(index + 1, true)} disabled={index >= count - 1}>
          Next
        </button>
        <button onClick={() => go(count - 1, false)} disabled={index >= count - 1}>
          End
        </button>
        <button onClick={() => play(n)}>Replay step</button>
        <label className="progress">
          Progress
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(t * 1000)}
            onChange={(e) => {
              stop();
              setT(Number(e.target.value) / 1000);
            }}
            data-testid="progress"
          />
        </label>
        <button onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
      </div>

      <div className="caption">
        <strong>{step.step.label}.</strong> {step.step.caption?.original ?? ""}
        <span className="muted"> [{step.step.level}]</span>
        {step.warnings.map((w, i) => (
          <div key={i} className="warning">
            {w}
          </div>
        ))}
        {step.error && <div className="error">{step.error}</div>}
      </div>

      <div className="panes">
        {image && (
          <figure className="pane">
            <figcaption>Book</figcaption>
            <img src={image} alt={`step ${step.step.label}`} />
          </figure>
        )}
        <figure className="pane">
          <figcaption>Diagram</figcaption>
          <div className="diagram" data-testid="diagram" dangerouslySetInnerHTML={{ __html: step.diagram }} />
        </figure>
        <figure className="pane">
          <figcaption>3D</figcaption>
          <Fold3D motion={motion} t={localT} colorUp={colorUp} colorDown={colorDown} resetKey={resetKey} />
        </figure>
      </div>

      <ol className="steps">
        {run.steps.map((s, i) => (
          <li key={s.step.id} className={i === index ? "current" : s.error ? "failed" : ""}>
            <button className="link" onClick={() => go(i, false)}>
              {s.step.label}. {s.step.caption?.original ?? s.step.actions?.map((a) => a.op).join(", ")}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
