import { useEffect, useRef } from "react";
import ear from "rabbit-ear";
import type { Fold } from "../lib/foldDoc";
import { useT } from "../i18n";

/** 2D view of one FOLD frame, drawn by Rabbit Ear. Mountain/valley styling comes from styles.css. */
export function CreasePattern2D({ frame }: { frame: Fold | null }) {
  const host = useRef<HTMLDivElement>(null);
  const t = useT();

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
      <div className="panel-title">{t("view2d")}</div>
      <div className="cp-host" ref={host} />
      <div className="legend">
        <span className="legend-item mountain">{t("mountain")}</span>
        <span className="legend-item valley">{t("valley")}</span>
        <span className="legend-item flat">{t("flat")}</span>
        <span className="legend-item boundary">{t("boundary")}</span>
      </div>
    </div>
  );
}
