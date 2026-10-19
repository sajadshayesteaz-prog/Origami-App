import { axiom1, axiom2, axiom3, axiom4, axiom5, axiom6, axiom7 } from "./axioms";
import { ActionError } from "./errors";
import { dist, lerp2, lineThrough, intersectLines, projectOnLine, type Line, type Vec2 } from "./geom";
import { CORNERS, cpToModel, modelToCP, modelToView, viewToModel, type PaperState } from "./state";

/**
 * References in actions (core-design §5.1–5.2). Everything resolves in the current *view*
 * (after turn over / rotate), because that is how diagrams describe folds.
 */
export type PointRef =
  | string // "A" | "B" | "C" | "D" | "O"
  | { name: string }
  | { mid: [PointRef, PointRef]; as?: string }
  | { at: [PointRef, PointRef, number | string]; as?: string }
  | { x: [LineRef, LineRef]; as?: string }
  | { cp: [number, number]; as?: string };

export type Pick = number | { near: PointRef };

export type LineRef =
  | { through: [PointRef, PointRef]; pick?: Pick }
  | { bring: PointRef; to: PointRef; pick?: Pick }
  | { edgeTo: [LineRef, LineRef]; pick?: Pick }
  | { perpendicularTo: LineRef; through: PointRef; pick?: Pick }
  | { bring: PointRef; onto: LineRef; through: PointRef; pick?: Pick }
  | { bring: [PointRef, PointRef]; onto: [LineRef, LineRef]; pick?: Pick }
  | { bring: PointRef; onto: LineRef; perpendicularTo: LineRef; pick?: Pick }
  | { name: string };

function parseFraction(t: number | string): number {
  if (typeof t === "number") return t;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(t);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(t);
  if (Number.isNaN(n)) throw new ActionError(`bad fraction "${t}"`);
  return n;
}

const describe = (r: unknown) => JSON.stringify(r);

/**
 * A resolved point: its view position, and its paper (CP) position when it is a point of the
 * paper — corners, O, named points, `cp` points, and `mid`/`at` between such points.
 */
interface Anchored {
  view: Vec2;
  cp: Vec2 | null;
}

const fromCP = (s: PaperState, cp: Vec2): Anchored => ({ view: modelToView(s, cpToModel(s, cp)), cp });

function resolveAnchored(s: PaperState, ref: PointRef): Anchored {
  if (typeof ref === "string") {
    const c = CORNERS[ref] ?? s.names.points[ref];
    if (!c) throw new ActionError(`unknown point "${ref}" (use A, B, C, D, O or a named point)`);
    return fromCP(s, c);
  }
  let r: Anchored;
  if ("name" in ref) {
    const cp = s.names.points[ref.name];
    if (!cp) throw new ActionError(`unknown point name "${ref.name}"`);
    return fromCP(s, cp);
  } else if ("mid" in ref || "at" in ref) {
    const [a, b, t] = "mid" in ref ? [ref.mid[0], ref.mid[1], 0.5] : [ref.at[0], ref.at[1], parseFraction(ref.at[2])];
    const pa = resolveAnchored(s, a);
    const pb = resolveAnchored(s, b);
    // Between two paper points: the point of the paper (e.g. the midpoint of edge AB), wherever it now lies.
    r = pa.cp && pb.cp ? fromCP(s, lerp2(pa.cp, pb.cp, t)) : { view: lerp2(pa.view, pb.view, t), cp: null };
  } else if ("x" in ref) {
    const x = intersectLines(resolveLine(s, ref.x[0]), resolveLine(s, ref.x[1]));
    if (!x) throw new ActionError(`lines in ${describe(ref)} are parallel`);
    r = { view: x, cp: null };
  } else if ("cp" in ref) r = fromCP(s, ref.cp);
  else throw new ActionError(`unknown point reference ${describe(ref)}`);
  if ("as" in ref && ref.as) s.names.points[ref.as] = r.cp ?? modelToCP(s, viewToModel(s, r.view));
  return r;
}

/** Resolves a point reference to view coordinates. Points with `as` are registered by name. */
export function resolvePoint(s: PaperState, ref: PointRef): Vec2 {
  return resolveAnchored(s, ref).view;
}

function choose(s: PaperState, lines: Line[], pick: Pick | undefined, ref: unknown): Line {
  if (!lines.length) throw new ActionError(`no fold line satisfies ${describe(ref)}`);
  if (pick === undefined) return lines[0];
  if (typeof pick === "number") {
    if (!lines[pick]) throw new ActionError(`pick ${pick} is out of range: ${lines.length} solution(s) for ${describe(ref)}`);
    return lines[pick];
  }
  const hint = resolvePoint(s, pick.near);
  return lines.slice().sort((a, b) => dist(projectOnLine(a, hint), hint) - dist(projectOnLine(b, hint), hint))[0];
}

/** Resolves a fold-line definition (axioms O1–O7) or a named line, in view coordinates. */
export function resolveLine(s: PaperState, ref: LineRef): Line {
  const r = ref as Record<string, any>;
  if ("name" in r) {
    const seg = s.names.lines[r.name];
    if (!seg) throw new ActionError(`unknown line name "${r.name}"`);
    return lineThrough(modelToView(s, cpToModel(s, seg[0])), modelToView(s, cpToModel(s, seg[1])));
  }
  const P = (x: PointRef) => resolvePoint(s, x);
  const L = (x: LineRef) => resolveLine(s, x);
  let lines: Line[];
  if ("through" in r && !("perpendicularTo" in r) && !("onto" in r)) lines = axiom1(P(r.through[0]), P(r.through[1]));
  else if ("bring" in r && "to" in r) lines = axiom2(P(r.bring), P(r.to));
  else if ("edgeTo" in r) lines = axiom3(L(r.edgeTo[0]), L(r.edgeTo[1]));
  else if ("perpendicularTo" in r && "through" in r) lines = axiom4(P(r.through), L(r.perpendicularTo));
  else if ("bring" in r && "onto" in r && Array.isArray(r.bring)) lines = axiom6(P(r.bring[0]), L(r.onto[0]), P(r.bring[1]), L(r.onto[1]));
  else if ("bring" in r && "onto" in r && "through" in r) lines = axiom5(P(r.bring), L(r.onto), P(r.through));
  else if ("bring" in r && "onto" in r && "perpendicularTo" in r) lines = axiom7(P(r.bring), L(r.onto), L(r.perpendicularTo));
  else throw new ActionError(`unknown line definition ${describe(ref)}`);
  return choose(s, lines, r.pick, ref);
}
