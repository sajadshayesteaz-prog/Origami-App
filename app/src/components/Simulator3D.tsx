import { useEffect, useRef, useState } from "react";
import { withFoldAngles, type Fold } from "../lib/foldDoc";

/** What to fold: one FOLD frame, or an Origami Simulator–style SVG crease pattern. */
export type SimInput = { kind: "fold"; frame: Fold; title?: string } | { kind: "svg"; svg: string; filename: string };

const SIM_URL = `${import.meta.env.BASE_URL}origami-simulator/index.html?model=none`;

/**
 * 3D folded state, computed by Origami Simulator running in an iframe
 * (copied from vendor by tools/sync-simulator.mjs). Talks to it with the simulator's
 * own postMessage API (importFold / importSVG) plus the embed shim (setFoldPercent, resetView).
 */
export function Simulator3D({ input }: { input: SimInput | null }) {
  const frameEl = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState(100);
  const [warning, setWarning] = useState<string | null>(null);

  const post = (msg: object) => frameEl.current?.contentWindow?.postMessage(msg, "*");

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameEl.current?.contentWindow || e.data?.from !== "OrigamiSimulator") return;
      if (e.data.status === "ready") setReady(true);
      if (e.data.status === "warning") setWarning(e.data.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!ready || !input) return;
    setWarning(null);
    if (input.kind === "fold") {
      post({ op: "importFold", fold: { file_title: input.title, ...withFoldAngles(input.frame) } });
    } else {
      post({ op: "importSVG", svg: input.svg, filename: input.filename });
    }
  }, [ready, input]);

  useEffect(() => {
    if (ready) post({ op: "setFoldPercent", value: percent / 100 });
  }, [ready, percent]);

  return (
    <div className="panel">
      <div className="panel-title">Folded state (3D)</div>
      <div className="sim-host">
        <iframe ref={frameEl} src={SIM_URL} title="Origami Simulator" />
        {!ready && <div className="overlay">Loading simulator…</div>}
        {warning && <div className="sim-warning">{warning}</div>}
      </div>
      <div className="sim-controls">
        <label>
          Fold amount
          <input type="range" min={0} max={100} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
          <span className="num">{percent}%</span>
        </label>
        <button onClick={() => post({ op: "resetView" })}>Reset view</button>
      </div>
    </div>
  );
}
