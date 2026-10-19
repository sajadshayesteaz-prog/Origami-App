import ear from "rabbit-ear";
import { edgeFaces, facePolygon, type Assignment } from "./cp";
import { ActionError } from "./errors";
import { AREA_TOL, convexIntersectionArea, dot, lineThrough, polygonArea, polygonCentroid, signedDist, sub, type Line, type Vec2 } from "./geom";
import { applyPoint, matEquals, multiply, rotationAbout, type Mat4 } from "./mat";
import { resolveLine, resolvePoint, type LineRef, type PointRef } from "./refs";
import { cloneState, computeHeights, faceUp, modelPolygon, overlapMatrix, viewToModel, viewTopFirst, viewUp, type PaperState } from "./state";
import { viewLineToModel } from "./fold";

/** One crease to set in a collapse: where it is (view), which layers, and its new type. */
export interface CreaseSpec {
  segment?: [PointRef, PointRef];
  line?: LineRef;
  layers?: "all" | { top: number } | { bottom: number };
  /** Valley/mountain/flat as seen by the viewer on the upper of the crease's two faces. */
  type?: "V" | "M" | "F";
  /** Raw crease-pattern assignment (relative to the paper's front), overrides `type`. */
  assign?: "V" | "M" | "F";
}

export interface CollapseResult {
  after: PaperState;
  root: number;
  /** Edges whose assignment changed. */
  changed: number[];
  /** Number of layer orders the solver found (≥ 1). */
  solutions: number;
  /** Changed creases as view segments with their view type, for the diagram. */
  creases: { a: Vec2; b: Vec2; type: "V" | "M" | "F" }[];
}

const swap = (a: "V" | "M" | "F"): "V" | "M" | "F" => (a === "V" ? "M" : a === "M" ? "V" : "F");
export const assignmentAngle = (a: Assignment) => (a === "V" ? Math.PI : a === "M" ? -Math.PI : 0);

/** Model position of a CP vertex through face f. */
const vertexModel = (s: PaperState, f: number, v: number): Vec2 => {
  const p = s.cp.vertices[v];
  const m = applyPoint(s.faceM[f], [p[0], p[1], 0]);
  return [m[0], m[1]];
};

function matchEdges(s: PaperState, spec: CreaseSpec): number[] {
  let line: Line;
  let range: [number, number] | null = null;
  if (spec.segment) {
    const a = viewToModel(s, resolvePoint(s, spec.segment[0]));
    const b = viewToModel(s, resolvePoint(s, spec.segment[1]));
    line = lineThrough(a, b);
    range = [0, dot(sub(b, a), line.d)];
  } else if (spec.line) {
    line = viewLineToModel(s, resolveLine(s, spec.line));
    const n = Math.hypot(line.d[0], line.d[1]);
    line = { p: line.p, d: [line.d[0] / n, line.d[1] / n] };
  } else throw new ActionError("a collapse crease needs a segment or a line");
  const ef = edgeFaces(s.cp);
  const hits: { e: number; faces: number[] }[] = [];
  s.cp.edges.forEach((edge, e) => {
    if (edge.a === "B" || ef[e].length !== 2) return;
    const f = ef[e][0];
    const pts = edge.v.map((v) => vertexModel(s, f, v));
    if (!pts.every((p) => Math.abs(signedDist(line, p)) < 1e-6)) return;
    if (range) {
      const ts = pts.map((p) => dot(sub(p, line.p), line.d));
      if (ts.some((t) => t < Math.min(...range!) - 1e-6 || t > Math.max(...range!) + 1e-6)) return;
    }
    hits.push({ e, faces: ef[e] });
  });
  const layers = spec.layers ?? "all";
  if (layers === "all") return hits.map((h) => h.e);
  // Rank the faces along the crease from the viewer's side; keep creases on the top/bottom n.
  const order = "top" in layers ? viewTopFirst(s) : viewTopFirst(s).reverse();
  const n = "top" in layers ? layers.top : layers.bottom;
  const faces = [...new Set(hits.flatMap((h) => h.faces))];
  const polys = new Map(faces.map((f) => [f, modelPolygon(s, f)]));
  const seen: number[] = [];
  const chosen = new Set<number>();
  const depth = new Map<number, number>();
  for (const f of order) {
    if (!polys.has(f)) continue;
    let d = 0;
    for (const g of seen) if (convexIntersectionArea(polys.get(f)!, polys.get(g)!) > AREA_TOL) d = Math.max(d, depth.get(g)! + 1);
    depth.set(f, d);
    if (d < n) chosen.add(f);
    seen.push(f);
  }
  return hits.filter((h) => h.faces.some((f) => chosen.has(f))).map((h) => h.e);
}

/** Face transforms from crease assignments, by walking a spanning tree from `root` (kept fixed). */
export function transformsFromAngles(s: PaperState, root: number, angle: (e: number) => number): Mat4[] {
  const ef = edgeFaces(s.cp);
  const faceEdges = s.cp.faces.map(() => [] as number[]);
  ef.forEach((fs, e) => fs.forEach((f) => faceEdges[f].push(e)));
  const M: (Mat4 | null)[] = s.cp.faces.map(() => null);
  M[root] = s.faceM[root].slice();
  const queue = [root];
  while (queue.length) {
    const p = queue.shift()!;
    for (const e of faceEdges[p]) {
      const c = ef[e].find((f) => f !== p);
      if (c === undefined || M[c]) continue;
      M[c] = multiply(M[p]!, hingeRotation(s, e, c, angle(e)));
      queue.push(c);
    }
  }
  return M.map((m, f) => {
    if (!m) throw new ActionError(`face ${f} is not connected to the rest of the paper`);
    return m;
  });
}

/** Rotation in CP space that folds `child` about edge e by `angle` (positive = toward the front). */
function hingeRotation(s: PaperState, e: number, child: number, angle: number): Mat4 {
  const [a, b] = s.cp.edges[e].v.map((v) => s.cp.vertices[v]);
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1]);
  const u: Vec2 = [d[0] / len, d[1] / len];
  // m: in-plane normal pointing into the child face; axis = m × z makes positive angles lift the child.
  const c = polygonCentroid(facePolygon(s.cp, child));
  const side = signedDist({ p: a, d: u }, c) > 0 ? 1 : -1;
  const m: Vec2 = [-u[1] * side, u[0] * side];
  return rotationAbout([a[0], a[1], 0], [m[1], -m[0], 0], angle);
}

/** Collapse: set crease types, then solve the flat folded state and its layer order (core-design §6). */
export function collapse(state: PaperState, specs: CreaseSpec[], opts: { root?: PointRef; solution?: number } = {}): CollapseResult {
  const s = cloneState(state);
  const ef = edgeFaces(s.cp);
  const changed = new Set<number>();
  const creases: CollapseResult["creases"] = [];
  const topFirst = viewTopFirst(state);
  for (const spec of specs) {
    const edges = matchEdges(state, spec);
    if (!edges.length) throw new ActionError(`collapse crease ${JSON.stringify(spec)} matches no crease on the paper`);
    for (const e of edges) {
      // The crease as seen: on the upper of its two faces, front or back toward the viewer.
      const upper = topFirst.find((f) => ef[e].includes(f))!;
      const seenFront = faceUp(state, upper) * viewUp(state) > 0;
      let a: "V" | "M" | "F";
      if (spec.assign) a = spec.assign;
      else if (spec.type) a = seenFront ? spec.type : swap(spec.type);
      else throw new ActionError("a collapse crease needs a type (V/M/F) or an assign");
      if (s.cp.edges[e].a !== a) changed.add(e);
      s.cp.edges[e].a = a;
      const pts = s.cp.edges[e].v.map((v) => vertexModel(state, ef[e][0], v));
      const viewType: "V" | "M" | "F" = spec.type ?? (seenFront ? a : swap(a));
      creases.push({ a: toView(state, pts[0]), b: toView(state, pts[1]), type: viewType });
    }
  }

  // Root: a face that keeps its place — given, or the largest face away from the changed creases.
  let root: number;
  if (opts.root !== undefined) {
    const p = viewToModel(state, resolvePoint(state, opts.root));
    const f = topFirst.find((g) => pointIn(modelPolygon(state, g), p));
    if (f === undefined) throw new ActionError(`collapse root ${JSON.stringify(opts.root)} is not on the paper`);
    root = f;
  } else {
    const touched = new Set([...changed].flatMap((e) => ef[e]));
    const area = (f: number) => Math.abs(polygonArea(facePolygon(s.cp, f)));
    const all = s.cp.faces.map((_, f) => f);
    const free = all.filter((f) => !touched.has(f));
    root = (free.length ? free : all).sort((a, b) => area(b) - area(a))[0];
  }

  s.faceM = transformsFromAngles(s, root, (e) => assignmentAngle(s.cp.edges[e].a));
  checkFlatConsistent(s);

  const { order, solutions } = solveOrder(state, s, opts.solution ?? 0);
  s.order = order;
  s.heights = computeHeights(s);
  return { after: s, root, changed: [...changed], solutions, creases };
}

/** Every crease must agree from both sides (no tearing) and the result must be flat. */
export function checkFlatConsistent(s: PaperState) {
  const ef = edgeFaces(s.cp);
  ef.forEach((fs, e) => {
    if (fs.length !== 2) return;
    for (const v of s.cp.edges[e].v) {
      const p = vertexModel(s, fs[0], v);
      const q = vertexModel(s, fs[1], v);
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6)
        throw new ActionError(
          `the creases are not flat-foldable as assigned (paper would tear near CP point ${s.cp.vertices[v].map((x) => x.toFixed(3)).join(", ")})`,
        );
    }
  });
  for (const m of s.faceM) if (Math.abs(m[14]) > 1e-6 || Math.abs(Math.abs(m[10]) - 1) > 1e-6) throw new ActionError("the result is not flat");
}

const toView = (s: PaperState, p: Vec2): Vec2 => {
  const v = applyPoint(s.view, [p[0], p[1], 0]);
  return [v[0], v[1]];
};

function pointIn(poly: Vec2[], p: Vec2) {
  const ccw = polygonArea(poly) > 0 ? 1 : -1;
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return ccw * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-9;
  });
}

/**
 * Layer order of a flat state with Rabbit Ear's layer solver (the one external piece, §9).
 * Pairs of faces that did not move keep their previous order (passed as constraints).
 */
function solveOrder(before: PaperState, after: PaperState, pick: number): { order: number[]; solutions: number } {
  const coords = after.cp.vertices.map((_, v) => {
    const f = after.cp.faces.findIndex((loop) => loop.includes(v));
    return vertexModel(after, f, v);
  });
  const graph: Record<string, unknown> = {
    vertices_coords: coords,
    edges_vertices: after.cp.edges.map((e) => e.v),
    edges_assignment: after.cp.edges.map((e) => e.a),
    edges_foldAngle: after.cp.edges.map((e) => (assignmentAngle(e.a) * 180) / Math.PI),
    faces_vertices: after.cp.faces,
  };
  const ovBefore = overlapMatrix(before);
  const ovAfter = overlapMatrix(after);
  const known: [number, number, number][] = [];
  const n = after.cp.faces.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (!ovAfter[i][j] || !ovBefore[i]?.[j]) continue;
      if (!matEquals(before.faceM[i], after.faceM[i]) || !matEquals(before.faceM[j], after.faceM[j])) continue;
      // FOLD faceOrders: [f, g, s] = face f lies on side s of face g (along g's normal).
      const iAbove = before.order.indexOf(i) > before.order.indexOf(j);
      known.push([i, j, (iAbove ? 1 : -1) * faceUp(after, j)]);
    }
  let solution: any;
  for (const constraints of known.length ? [known, null] : [null]) {
    try {
      solution = ear.layer(constraints ? { ...graph, faceOrders: constraints } : graph);
      solution.faceOrders();
      break;
    } catch {
      solution = null;
    }
  }
  if (!solution) throw new ActionError("no valid layer order exists for this collapse (the creases cannot fold flat without crossing)");
  let all: [number, number, number][][];
  try {
    all = solution.compileAll();
  } catch {
    all = [solution.faceOrders()];
  }
  if (!all.length) all = [solution.faceOrders()];
  if (pick >= all.length) throw new ActionError(`solution ${pick} does not exist: the collapse has ${all.length} layer arrangement(s)`);
  return { order: linearize(before, after, all[pick]), solutions: all.length };
}

/** Faces bottom → top from pairwise orders; ties keep the previous order for stability. */
export function linearize(before: PaperState, after: PaperState, faceOrders: [number, number, number][]): number[] {
  const n = after.cp.faces.length;
  const below: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const [a, b, side] of faceOrders) {
    // [a, b, s]: face a lies on side s of face b, along b's normal (FOLD spec).
    const aAbove = side * faceUp(after, b) > 0;
    if (aAbove) below[a].add(b);
    else below[b].add(a);
  }
  const prio = (f: number) => {
    const i = before.order.indexOf(f);
    return i === -1 ? f : i;
  };
  const out: number[] = [];
  const done = new Set<number>();
  while (out.length < n) {
    const ready = [...Array(n).keys()].filter((f) => !done.has(f) && [...below[f]].every((g) => done.has(g)));
    if (!ready.length) throw new ActionError("the layer order has a cycle");
    ready.sort((x, y) => prio(x) - prio(y));
    out.push(ready[0]);
    done.add(ready[0]);
  }
  return out;
}
