import { edgeFaces, splitFace } from "./cp";
import { ActionError } from "./errors";
import {
  add,
  AREA_TOL,
  clipHalfPlane,
  convexIntersectionArea,
  lineConvexInterval,
  polygonArea,
  polygonCentroid,
  scale,
  signedDist,
  sub,
  TOL,
  type Line,
  type Vec2,
} from "./geom";
import { applyPoint, invertRigid, multiply, rotationAbout } from "./mat";
import { resolvePoint, type PointRef } from "./refs";
import {
  CORNERS,
  cloneState,
  computeHeights,
  cpToModel,
  faceUp,
  modelPolygon,
  overlapMatrix,
  viewToModel,
  viewTopFirst,
  viewUp,
  type PaperState,
} from "./state";

/** Layer selection (core-design §5.3). */
export type LayerSel = "all" | { top: number } | { bottom: number } | { flap: PointRef } | { faces: number[] };

export interface FoldResult {
  /** The state before the fold with the crossed faces split (same geometry as before). */
  split: PaperState;
  /** The state after the fold. */
  folded: PaperState;
  moving: number[];
  /** Fold line in model coordinates. */
  hinge: Line;
  /** +1 if the moving side is on the hinge's left. */
  side: 1 | -1;
  /** +1: moving faces swing toward model +z (a valley as seen from model +z). */
  dir: 1 | -1;
  warnings: string[];
}

export function viewLineToModel(s: PaperState, l: Line): Line {
  const p = viewToModel(s, l.p);
  const q = viewToModel(s, add(l.p, l.d));
  return { p, d: sub(q, p) };
}

export const sideArea = (poly: Vec2[], l: Line, side: 1 | -1) => {
  const c = clipHalfPlane(poly, l, side);
  return c.length < 3 ? 0 : Math.abs(polygonArea(c));
};

/** Default moving side: the smaller part moves; on a tie, the part away from the paper's anchor corner. */
function defaultSide(s: PaperState, l: Line, faces: number[]): 1 | -1 {
  let plus = 0;
  let minus = 0;
  for (const f of faces) {
    const poly = modelPolygon(s, f);
    plus += sideArea(poly, l, 1);
    minus += sideArea(poly, l, -1);
  }
  if (plus < AREA_TOL || minus < AREA_TOL) throw new ActionError("the fold line does not cross the selected paper");
  if (Math.abs(plus - minus) > 1e-6 * (plus + minus)) return plus < minus ? 1 : -1;
  for (const k of ["D", "A", "B", "C"]) {
    const a = cpToModel(s, CORNERS[k]);
    const d = signedDist(l, a);
    if (Math.abs(d) > TOL) return d > 0 ? -1 : 1;
  }
  return 1;
}

/**
 * Faces selected by a layer spec among the faces that reach the moving side.
 * "top n" counts layers at each place: a face is in the top n if fewer than n overlapping
 * candidates lie above it (on the moving side), as seen by the viewer.
 */
export function selectLayers(s: PaperState, l: Line, side: 1 | -1, sel: LayerSel): number[] {
  const candidates = s.cp.faces.map((_, f) => f).filter((f) => sideArea(modelPolygon(s, f), l, side) > AREA_TOL);
  if (sel === "all") return candidates;
  if ("faces" in sel) {
    for (const f of sel.faces) if (!s.cp.faces[f]) throw new ActionError(`no face ${f}`);
    return sel.faces.filter((f) => candidates.includes(f));
  }
  if ("flap" in sel) {
    const p = viewToModel(s, resolvePoint(s, sel.flap));
    const f = viewTopFirst(s).find((g) => candidates.includes(g) && polygonContains(modelPolygon(s, g), p));
    if (f === undefined) throw new ActionError(`no flap at ${JSON.stringify(sel.flap)} on the moving side`);
    return [f];
  }
  const n = "top" in sel ? sel.top : sel.bottom;
  const ranked = "top" in sel ? viewTopFirst(s) : viewTopFirst(s).reverse();
  const clipped = new Map(candidates.map((f) => [f, clipHalfPlane(modelPolygon(s, f), l, side)]));
  // Layer depth from the viewer's side (pieces of one layer share a depth).
  const chosen: number[] = [];
  const seen: number[] = [];
  const depth = new Map<number, number>();
  for (const f of ranked) {
    if (!clipped.has(f)) continue;
    let d = 0;
    for (const g of seen) if (convexIntersectionArea(clipped.get(f)!, clipped.get(g)!) > AREA_TOL) d = Math.max(d, depth.get(g)! + 1);
    depth.set(f, d);
    if (d < n) chosen.push(f);
    seen.push(f);
  }
  return chosen;
}

function polygonContains(poly: Vec2[], p: Vec2) {
  const ccw = polygonArea(poly) > 0 ? 1 : -1;
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return ccw * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-9;
  });
}

/** Splits face f of state s by a model-space line; the new face inherits transform, order slot and height. */
export function splitStateFace(s: PaperState, f: number, l: Line): number | null {
  const inv = invertRigid(s.faceM[f]);
  const p = applyPoint(inv, [l.p[0], l.p[1], 0]);
  const q = applyPoint(inv, [l.p[0] + l.d[0], l.p[1] + l.d[1], 0]);
  const lineCP: Line = { p: [p[0], p[1]], d: [q[0] - p[0], q[1] - p[1]] };
  const r = splitFace(s.cp, f, lineCP, "F");
  if (!r) return null;
  s.faceM[r.right] = s.faceM[f].slice();
  s.heights[r.right] = s.heights[f];
  s.order.splice(s.order.indexOf(f) + 1, 0, r.right);
  return r.right;
}

const faceSide = (s: PaperState, f: number, l: Line): 1 | -1 => (signedDist(l, polygonCentroid(modelPolygon(s, f))) > 0 ? 1 : -1);

export function edgeOnLine(s: PaperState, e: number, f: number, l: Line) {
  return s.cp.edges[e].v.every((v) => {
    const p = s.cp.vertices[v];
    const m = applyPoint(s.faceM[f], [p[0], p[1], 0]);
    return Math.abs(signedDist(l, [m[0], m[1]])) < 1e-6;
  });
}

/** Assignment of the crease between faces f and g from their final placement and stacking. */
export function creaseAssignment(s: PaperState, f: number, g: number): "V" | "M" | "F" {
  if (faceUp(s, f) === faceUp(s, g)) return "F";
  const gAbove = s.order.indexOf(g) > s.order.indexOf(f);
  return gAbove === faceUp(s, f) > 0 ? "V" : "M";
}

export interface FoldOptions {
  /** Fold line in view coordinates. */
  line: Line;
  /** "valley" / "mountain" as seen by the viewer, or "auto" (unfold: whichever way opens the flap). */
  type: "valley" | "mountain" | "auto";
  move?: PointRef;
  layers?: LayerSel;
  /** False for unfold: the line must run along existing creases. */
  allowSplit: boolean;
}

/** Folds selected layers along a line by 180° (core-design §6). Pure: returns new states. */
export function foldAlong(state: PaperState, opts: FoldOptions): FoldResult {
  if (opts.type === "auto") return unfoldAlong(state, opts, viewLineToModel(state, opts.line));
  const p = prepareFold(state, opts);
  return finishFold(state, p.split, p.moving, p.hinge, p.side, opts.type === "valley" ? 1 : -1, p.warnings);
}

export interface PreparedFold {
  /** Before-state with the crossed faces split. */
  split: PaperState;
  /** Faces on the moving side (selected layers grown by closure). */
  moving: Set<number>;
  /** Line in model space. */
  hinge: Line;
  side: 1 | -1;
  warnings: string[];
}

/** First half of a fold: line, moving side, layer selection, face splitting and closure. */
export function prepareFold(state: PaperState, opts: Omit<FoldOptions, "type">): PreparedFold {
  const warnings: string[] = [];
  const l = viewLineToModel(state, opts.line);
  const sel0 = opts.layers ?? "all";
  let side: 1 | -1;
  if (opts.move !== undefined) {
    const p = viewToModel(state, resolvePoint(state, opts.move));
    const d = signedDist(l, p);
    if (Math.abs(d) < TOL) throw new ActionError(`the "move" point ${JSON.stringify(opts.move)} lies on the fold line`);
    side = d > 0 ? 1 : -1;
  } else {
    side = defaultSide(state, l, state.cp.faces.map((_, f) => f));
  }
  const selected = selectLayers(state, l, side, sel0);
  if (!selected.length) throw new ActionError("no layers selected on the moving side of the fold line");

  const s = cloneState(state);
  const moving = new Set<number>();
  const take = (f: number, reason: string | null) => {
    const poly = modelPolygon(s, f);
    const onMove = sideArea(poly, l, side) > AREA_TOL;
    const onStay = sideArea(poly, l, -side as 1 | -1) > AREA_TOL;
    if (onMove && onStay) {
      if (!opts.allowSplit) throw new ActionError("there is no existing fold along this line to unfold (it would cut a layer)");
      const g = splitStateFace(s, f, l)!;
      const m = faceSide(s, f, l) === side ? f : g;
      moving.add(m);
      if (reason) warnings.push(reason);
      return true;
    }
    if (onMove) {
      moving.add(f);
      if (reason) warnings.push(reason);
      return true;
    }
    return false;
  };
  for (const f of selected) take(f, null);

  // Closure: faces joined to a moving face by an edge off the fold line must move too.
  for (let changed = true; changed; ) {
    changed = false;
    const ef = edgeFaces(s.cp);
    outer: for (const m of moving) {
      const loop = s.cp.faces[m];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const e = s.cp.edges.findIndex((x) => (x.v[0] === a && x.v[1] === b) || (x.v[0] === b && x.v[1] === a));
        if (edgeOnLine(s, e, m, l)) continue;
        for (const g of ef[e]) {
          if (g === m || moving.has(g)) continue;
          const poly = modelPolygon(s, g);
          if (sideArea(poly, l, side) <= AREA_TOL)
            throw new ActionError(
              "the fold would tear the paper: a layer attached to the moving flap lies on the fixed side of the line (select fewer layers or a different line)",
            );
          take(g, "the moving flap pulled in an unselected layer (all layers of this flap fold together)");
          changed = true;
          break outer;
        }
      }
    }
  }
  return { split: s, moving, hinge: l, side, warnings };
}

/**
 * Unfold: the flap is the face given by `move` (topmost there) or, by default, the topmost face
 * along an existing folded crease on the line; it grows through every edge except the line.
 */
function unfoldAlong(state: PaperState, opts: FoldOptions, l: Line): FoldResult {
  const s = cloneState(state);
  const ef = edgeFaces(s.cp);
  const hingeFaces = new Set<number>();
  s.cp.edges.forEach((e, i) => {
    if ((e.a === "V" || e.a === "M") && ef[i].length === 2 && edgeOnLine(s, i, ef[i][0], l)) ef[i].forEach((f) => hingeFaces.add(f));
  });
  if (!hingeFaces.size) throw new ActionError("there is no existing fold along this line to unfold");
  let start: number | undefined;
  if (opts.move !== undefined) {
    const p = viewToModel(state, resolvePoint(state, opts.move));
    start = viewTopFirst(s).find((f) => hingeFaces.has(f) && polygonContains(modelPolygon(s, f), p));
    if (start === undefined) start = viewTopFirst(s).find((f) => polygonContains(modelPolygon(s, f), p));
    if (start === undefined) throw new ActionError(`the "move" point ${JSON.stringify(opts.move)} is not on the paper`);
  } else start = viewTopFirst(s).find((f) => hingeFaces.has(f))!;
  const moving = new Set<number>([start]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of [...moving]) {
      const loop = s.cp.faces[m];
      for (let i = 0; i < loop.length; i++) {
        const e = s.cp.edges.findIndex((x) => (x.v[0] === loop[i] && x.v[1] === loop[(i + 1) % loop.length]) || (x.v[1] === loop[i] && x.v[0] === loop[(i + 1) % loop.length]));
        if (edgeOnLine(s, e, m, l)) continue;
        for (const g of ef[e]) if (!moving.has(g)) moving.add(g), (grew = true);
      }
    }
  }
  for (const f of moving) {
    const poly = modelPolygon(s, f);
    if (sideArea(poly, l, 1) > AREA_TOL && sideArea(poly, l, -1) > AREA_TOL) throw new ActionError("there is no existing fold along this line to unfold (it would cut a layer)");
  }
  const side = faceSide(s, start, l);
  return finishFold(state, s, moving, l, side, "auto", []);
}

/** Shared tail of fold and unfold: direction, blocking check, new transforms, order and creases. */
function finishFold(state: PaperState, s: PaperState, moving: Set<number>, l: Line, side: 1 | -1, type: 1 | -1 | "auto", warnings: string[]): FoldResult {
  const movingList = [...moving];
  const stationary = s.order.filter((f) => !moving.has(f));
  if (!stationary.length) throw new ActionError("the whole paper would move; nothing stays in place");

  // Fold direction in model space. Unfold ("auto"): open the flap the way it can swing out.
  let dir: 1 | -1;
  if (type === "auto") {
    const pos = (f: number) => s.order.indexOf(f);
    const top = Math.max(...movingList.map(pos));
    const ov = overlapMatrix(s);
    const touching = stationary.filter((f) => movingList.some((m) => ov[m][f]));
    dir = touching.length === 0 || touching.every((f) => pos(f) < top) ? 1 : -1;
  } else {
    dir = (type * viewUp(state)) as 1 | -1;
  }

  // Blocking: a stationary layer on the swing side of a moving layer would be pierced.
  const ov = overlapMatrix(s);
  for (const m of movingList)
    for (const f of stationary) {
      if (!ov[m][f]) continue;
      const fAbove = s.order.indexOf(f) > s.order.indexOf(m);
      if (fAbove === dir > 0)
        throw new ActionError(
          `the fold is blocked: a layer ${dir * viewUp(state) > 0 ? "above" : "below"} the moving flap is in the way (select more layers, e.g. "layers": "all", or fold the other way)`,
        );
    }

  const folded = cloneState(s);
  const R = rotationAbout([l.p[0], l.p[1], 0], [l.d[0], l.d[1], 0], Math.PI);
  for (const m of movingList) folded.faceM[m] = multiply(R, folded.faceM[m]);
  const movingRev = s.order.filter((f) => moving.has(f)).reverse();
  folded.order = dir > 0 ? [...stationary, ...movingRev] : [...movingRev, ...stationary];

  // Hinge creases: edges between a moving and a stationary face.
  const ef = edgeFaces(folded.cp);
  ef.forEach((fs, e) => {
    if (fs.length !== 2 || moving.has(fs[0]) === moving.has(fs[1])) return;
    folded.cp.edges[e].a = creaseAssignment(folded, fs[0], fs[1]);
  });
  folded.heights = computeHeights(folded);
  return { split: s, folded, moving: movingList, hinge: l, side, dir, warnings };
}

/** Stores the fold line under a name, as two CP points on the paper. */
export function nameLine(s: PaperState, name: string, l: Line) {
  for (const f of viewTopFirst(s)) {
    const poly = modelPolygon(s, f);
    const iv = lineConvexInterval(l, poly);
    if (!iv) continue;
    const a: Vec2 = add(l.p, scale(l.d, iv[0]));
    const b: Vec2 = add(l.p, scale(l.d, iv[1]));
    const inv = invertRigid(s.faceM[f]);
    const pa = applyPoint(inv, [a[0], a[1], 0]);
    const pb = applyPoint(inv, [b[0], b[1], 0]);
    s.names.lines[name] = [
      [pa[0], pa[1]],
      [pb[0], pb[1]],
    ];
    return;
  }
  throw new ActionError(`cannot name line "${name}": it does not cross the paper`);
}

