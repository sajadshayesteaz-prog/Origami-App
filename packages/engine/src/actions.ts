import { collapse, type CreaseSpec } from "./collapse";
import { applyCompound, COMPOUND_OPS, type CompoundAction } from "./compounds";
import { ActionError } from "./errors";
import { foldAlong, nameLine, type FoldResult, type LayerSel } from "./fold";
import { add, lineConvexInterval, polygonArea, polygonCentroid, reflectPoint, scale, type Line, type Vec2 } from "./geom";
import { multiply, rotationAbout, type Vec3 } from "./mat";
import { collapseMotion, foldMotion, foldUnfoldMotion, stillMotion, viewMotion, type Motion } from "./motion";
import { resolveLine, type LineRef, type PointRef } from "./refs";
import { cloneState, modelPolygon, modelToView, type PaperState } from "./state";

/** Atomic actions of the action language v1 (core-design §5.4; docs/action-language.md). */
export type Action =
  | { op: "valley" | "mountain"; line: LineRef; layers?: LayerSel; move?: PointRef; as?: string; text?: string }
  | { op: "foldUnfold"; line: LineRef; type?: "V" | "M"; layers?: LayerSel; move?: PointRef; as?: string; text?: string }
  | { op: "unfold"; line: LineRef; layers?: LayerSel; move?: PointRef; text?: string }
  | { op: "collapse"; creases: CreaseSpec[]; root?: PointRef; solution?: number; text?: string }
  | { op: "turnOver"; axis?: "vertical" | "horizontal"; text?: string }
  | { op: "rotate"; degrees: number; text?: string }
  | { op: "zoom"; region: [number, number, number, number] | null; text?: string }
  | CompoundAction
  | { op: "group"; actions: Action[]; text?: string }
  | { op: "repeat"; steps: [string, string]; side?: "behind" | "same"; axis?: "vertical" | "horizontal"; map?: Record<string, string>; text?: string };

/** What the 2D diagram needs to draw an action on the state before it (view coordinates). */
export type Mark =
  | { kind: "fold"; line: Line; type: "V" | "M"; unfold: boolean; from: Vec2; to: Vec2; segment: [Vec2, Vec2] }
  | { kind: "unfold"; line: Line; from: Vec2; to: Vec2; segment: [Vec2, Vec2] }
  | { kind: "collapse"; creases: { a: Vec2; b: Vec2; type: "V" | "M" | "F" }[] }
  | { kind: "turnOver"; axis: "vertical" | "horizontal" }
  | { kind: "rotate"; degrees: number }
  | { kind: "zoom" }
  | {
      kind: "compound";
      label: string;
      creases: { a: Vec2; b: Vec2; type: "V" | "M" | "F"; hidden?: boolean }[];
      line?: { a: Vec2; b: Vec2; type: "V" | "M" };
      arrows?: { from: Vec2; to: Vec2; style: "valley" | "mountain" | "push" }[];
      tip?: Vec2;
    }
  | { kind: "repeat"; label: string };

export interface ActionResult {
  after: PaperState;
  motion: Motion;
  mark: Mark;
  warnings: string[];
}

/** The part of the fold line inside the moving layers, and an arrow from the flap to where it lands. */
function foldMarks(r: FoldResult, line: Line) {
  const polys = r.moving.map((f) => modelPolygon(r.split, f).map((p) => modelToView(r.split, p)));
  let best = polys[0];
  for (const p of polys) if (Math.abs(polygonArea(p)) > Math.abs(polygonArea(best))) best = p;
  const from = polygonCentroid(best);
  const to = reflectPoint(line, from);
  // The drawn fold line spans where the line meets the moving layers (their hinge edges).
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const poly of polys) {
    const iv = lineConvexInterval(line, poly);
    if (iv) [t0, t1] = [Math.min(t0, iv[0]), Math.max(t1, iv[1])];
  }
  if (!(t1 > t0)) {
    const ts = polys.flat().map((v) => (v[0] - line.p[0]) * line.d[0] + (v[1] - line.p[1]) * line.d[1]);
    [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  }
  const segment: [Vec2, Vec2] = [add(line.p, scale(line.d, t0)), add(line.p, scale(line.d, t1))];
  return { from, to, segment };
}

function normalizeLine(l: Line): Line {
  const n = Math.hypot(l.d[0], l.d[1]);
  return { p: l.p, d: [l.d[0] / n, l.d[1] / n] };
}

/** Runs one action on a state. Throws ActionError with a readable message if it is impossible. */
export function applyAction(state: PaperState, action: Action): ActionResult {
  switch (action.op) {
    case "valley":
    case "mountain": {
      const line = normalizeLine(resolveLine(state, action.line));
      const r = foldAlong(state, { line, type: action.op, move: action.move, layers: action.layers, allowSplit: true });
      if (action.as) nameLine(r.folded, action.as, r.hinge);
      const marks = foldMarks(r, line);
      return {
        after: r.folded,
        motion: foldMotion(r),
        mark: { kind: "fold", line, type: action.op === "valley" ? "V" : "M", unfold: false, ...marks },
        warnings: r.warnings,
      };
    }
    case "foldUnfold": {
      const line = normalizeLine(resolveLine(state, action.line));
      const type = action.type === "M" ? "mountain" : "valley";
      const r = foldAlong(state, { line, type, move: action.move, layers: action.layers, allowSplit: true });
      const end = cloneState(r.split);
      if (action.as) nameLine(end, action.as, r.hinge);
      const marks = foldMarks(r, line);
      return {
        after: end,
        motion: foldUnfoldMotion(r, end),
        mark: { kind: "fold", line, type: action.type === "M" ? "M" : "V", unfold: true, ...marks },
        warnings: r.warnings,
      };
    }
    case "unfold": {
      const line = normalizeLine(resolveLine(state, action.line));
      const r = foldAlong(state, { line, type: "auto", move: action.move, layers: action.layers, allowSplit: false });
      const marks = foldMarks(r, line);
      return { after: r.folded, motion: foldMotion(r), mark: { kind: "unfold", line, ...marks }, warnings: r.warnings };
    }
    case "collapse": {
      if (!action.creases?.length) throw new ActionError("collapse needs a list of creases");
      const r = collapse(state, action.creases, { root: action.root, solution: action.solution });
      const warnings = r.solutions > 1 ? [`collapse has ${r.solutions} layer arrangements; using solution ${action.solution ?? 0}`] : [];
      return { after: r.after, motion: collapseMotion(state, r.after, r.root), mark: { kind: "collapse", creases: r.creases }, warnings };
    }
    case "turnOver": {
      const axis = action.axis ?? "vertical";
      const a: Vec3 = axis === "vertical" ? [0, 1, 0] : [1, 0, 0];
      const after = cloneState(state);
      after.view = multiply(rotationAbout([0, 0, 0], a, Math.PI), state.view);
      return { after, motion: viewMotion(state, after, a, Math.PI, "turnOver"), mark: { kind: "turnOver", axis }, warnings: [] };
    }
    case "rotate": {
      if (typeof action.degrees !== "number") throw new ActionError("rotate needs degrees");
      const after = cloneState(state);
      const rad = (action.degrees * Math.PI) / 180;
      after.view = multiply(rotationAbout([0, 0, 0], [0, 0, 1], rad), state.view);
      return { after, motion: viewMotion(state, after, [0, 0, 1], rad, "rotate"), mark: { kind: "rotate", degrees: action.degrees }, warnings: [] };
    }
    case "zoom": {
      const after = cloneState(state);
      after.zoom = action.region ?? null;
      return { after, motion: stillMotion(after, "zoom"), mark: { kind: "zoom" }, warnings: [] };
    }
    default:
      if (COMPOUND_OPS.has((action as { op: string }).op)) return applyCompound(state, action as CompoundAction);
      throw new ActionError(`unknown action op ${JSON.stringify((action as { op?: unknown }).op)}`);
  }
}

