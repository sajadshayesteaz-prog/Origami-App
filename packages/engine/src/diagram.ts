import type { Mark } from "./actions";
import { edgeMap, edgeKey } from "./cp";
import { add, normalize, perp, scale, sub, type Vec2 } from "./geom";
import { faceUp, modelPolygon, modelToView, viewTopFirst, viewUp, type PaperState } from "./state";

/** Diagram style: book-like, black lines; valley dashed, mountain dash-dot (core-design §8). */
export interface DiagramOptions {
  colorUp?: string;
  colorDown?: string;
  /** Pixel size of the output. */
  size?: number;
}

const f = (x: number) => (Math.abs(x) < 1e-12 ? "0" : x.toFixed(4));
const pt = (p: Vec2) => `${f(p[0])},${f(-p[1])}`; // SVG y grows downward; diagrams use y up.

/**
 * SVG of a state as the viewer sees it, with the marks of the coming action drawn on top:
 * folded silhouette, visible edges, existing creases, the fold line and an arrow.
 */
export function renderDiagram(s: PaperState, marks: Mark[] = [], opts: DiagramOptions = {}): string {
  const colorUp = opts.colorUp ?? "#ffffff";
  const colorDown = opts.colorDown ?? "#f2a7b8";
  const size = opts.size ?? 400;
  const polys = s.cp.faces.map((_, i) => modelPolygon(s, i).map((p) => modelToView(s, p)));
  const all = polys.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (s.zoom) [x0, y0, x1, y1] = [s.zoom[0], s.zoom[1], s.zoom[0] + s.zoom[2], s.zoom[1] + s.zoom[3]];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const pad = span * 0.18;
  const vb = [x0 - pad, -(y1 + pad), x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  const unit = span / 100; // stroke and marker sizes scale with the drawing

  const em = edgeMap(s.cp);
  const parts: string[] = [];
  const bottomFirst = viewTopFirst(s).reverse();
  for (const i of bottomFirst) {
    const poly = polys[i];
    const showsFront = faceUp(s, i) * viewUp(s) > 0;
    parts.push(`<polygon points="${poly.map(pt).join(" ")}" fill="${showsFront ? colorUp : colorDown}" stroke="none"/>`);
    const loop = s.cp.faces[i];
    loop.forEach((v, k) => {
      const e = em.get(edgeKey(v, loop[(k + 1) % loop.length]));
      const a = e === undefined ? "B" : s.cp.edges[e].a;
      const p = poly[k];
      const q = poly[(k + 1) % poly.length];
      const crease = a === "F" || a === "U";
      parts.push(
        `<line x1="${f(p[0])}" y1="${f(-p[1])}" x2="${f(q[0])}" y2="${f(-q[1])}" stroke="${crease ? "#8a8a8a" : "#111"}" stroke-width="${f(crease ? unit * 0.35 : unit * 0.7)}" stroke-linecap="round"/>`,
      );
    });
  }

  for (const m of marks) parts.push(...markSvg(m, unit, [x0, x1, y0, y1]));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f).join(" ")}" width="${size}" height="${size}">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#111"/></marker></defs>`,
    ...parts,
    `</svg>`,
  ].join("\n");
}

const DASH: Record<"V" | "M" | "F", (u: number) => string> = {
  V: (u) => `${f(3 * u)} ${f(2 * u)}`,
  M: (u) => `${f(3 * u)} ${f(1.2 * u)} ${f(0.6 * u)} ${f(1.2 * u)}`,
  F: () => "none",
};

function foldLine(a: Vec2, b: Vec2, type: "V" | "M" | "F", u: number) {
  const color = type === "V" ? "#1f5fbf" : type === "M" ? "#c0392b" : "#555";
  return `<line x1="${f(a[0])}" y1="${f(-a[1])}" x2="${f(b[0])}" y2="${f(-b[1])}" stroke="${color}" stroke-width="${f(u * 0.8)}" stroke-dasharray="${DASH[type](u)}"/>`;
}

/** A curved arrow from p to q, bulging to the left; both heads for fold-and-unfold. */
function arrow(p: Vec2, q: Vec2, u: number, both: boolean) {
  const mid = scale(add(p, q), 0.5);
  const d = sub(q, p);
  const lenPQ = Math.hypot(d[0], d[1]);
  if (lenPQ < 1e-9) return "";
  const c = add(mid, scale(perp(normalize(d)), lenPQ * 0.35));
  const shrink = (a: Vec2, b: Vec2) => add(a, scale(normalize(sub(b, a)), u * 2));
  const a = shrink(p, c);
  const b = shrink(q, c);
  return `<path d="M${pt(a)} Q${pt(c)} ${pt(b)}" fill="none" stroke="#111" stroke-width="${f(u * 0.6)}" marker-end="url(#arrow)"${both ? ' marker-start="url(#arrow)"' : ""}/>`;
}

function markSvg(m: Mark, u: number, [x0, x1, y0, y1]: [number, number, number, number]): string[] {
  const text = (x: number, y: number, s: string) =>
    `<text x="${f(x)}" y="${f(-y)}" font-size="${f(u * 6)}" font-family="sans-serif" text-anchor="middle" fill="#111">${s}</text>`;
  switch (m.kind) {
    case "fold":
      return [foldLine(m.segment[0], m.segment[1], m.type, u), arrow(m.from, m.to, u, m.unfold)];
    case "unfold":
      return [foldLine(m.segment[0], m.segment[1], "F", u), arrow(m.from, m.to, u, false), text(m.from[0], m.from[1], "unfold")];
    case "collapse":
      return [...m.creases.map((c) => foldLine(c.a, c.b, c.type, u)), text((x0 + x1) / 2, y0 - u * 12, "collapse")];
    case "turnOver":
      return [text((x0 + x1) / 2, y0 - u * 12, `turn over (${m.axis})`)];
    case "rotate":
      return [text((x0 + x1) / 2, y0 - u * 12, `rotate ${m.degrees}°`)];
    default:
      return [];
  }
}
