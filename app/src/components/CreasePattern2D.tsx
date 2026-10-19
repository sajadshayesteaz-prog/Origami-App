import { useEffect, useRef } from "react";
import ear from "rabbit-ear";
import type { Fold } from "../lib/foldDoc";

/** 2D view of one FOLD frame, drawn by Rabbit Ear. Mountain/valley styling comes from styles.css. */
export function CreasePattern2D({ frame }: { frame: Fold | null }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    if (!frame) return;
    // "padding" is supported by foldToSvg but missing from its type declarations.
    const svg = ear.convert.foldToSvg(frame, { padding: 0.02 } as {}) as SVGSVGElement;
    svg.setAttribute("class", `${svg.getAttribute("class") ?? ""} cp-svg`);
    el.appendChild(svg);
  }, [frame]);

  return (
    <div className="panel">
      <div className="panel-title">Crease pattern (2D)</div>
      <div className="cp-host" ref={host} />
      <div className="legend">
        <span className="legend-item mountain">Mountain</span>
        <span className="legend-item valley">Valley</span>
        <span className="legend-item flat">Flat</span>
        <span className="legend-item boundary">Boundary</span>
      </div>
    </div>
  );
}
