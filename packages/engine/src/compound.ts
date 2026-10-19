import ear from "rabbit-ear";
import { checkFlatConsistent, linearize, transformsFromAngles } from "./collapse";
import { edgeFaces, type Assignment } from "./cp";
import { ActionError } from "./errors";
import { creaseAssignment, splitStateFace, viewLineToModel } from "./fold";
import { AREA_TOL, convexIntersectionArea, dot, lineConvexInterval, lineThrough, polygonArea, signedDist, sub, type Line, type Vec2 } from "./geom";
import { applyPoint } from "./mat";
import { cloneState, computeHeights, faceUp, modelPolygon, overlapMatrix, viewToModel, viewTopFirst, viewUp, type PaperState } from "./state";

/**
 * Compound folds (core-design §5.5) are built from one primitive: a set of creases that end up
 * folded (a "fold mask"), with layer-order constraints that say how the layers must stack
 * (e.g. "the tip goes between the layers" for an inside reverse fold). Face positions follow
 * from the mask (every folded crease is a half turn), the layer order comes from the layer
 * solver (Rabbit Ear) under the constraints, and mountain/valley are read off the result.
 */

/** FOLD faceOrders entry: [f, g, s] = face f lies on side s of face g (along g's normal). */
export type Order = [number, number, number];

/** Face a above face b (model +z), as a FOLD faceOrders entry relative to b. */
export const above = (s: PaperState, a: number, b: number, isAbove: boolean): Order => [a, b, (isAbove ? 1 : -1) * faceUp(s, b)];

const vertexModel = (s: PaperState, f: number, v: number): Vec2 => {
  const p = s.cp.vertices[v];
  const m = applyPoint(s.faceM[f], [p[0], p[1], 0]);
  return [m[0], m[1]];
};

export interface SolveResult {
  after: PaperState;
  solutions: number;
  warnings: string[];
}

/**
 * The flat state of `split` (a before-state, possibly with new creases) where exactly the
 * creases in `folded` are folded, `root` stays put, and the layer order satisfies `constraints`
 * (built from the new face positions). Pairs of faces that did not move keep their order where
 * possible. Mountain/valley of every folded crease follows from the solved order.
 */
export function solveFromMask(
  split: PaperState,
  folded: (e: number) => boolean,
  root: number,
  constraints: (positioned: PaperState) => Order[],
  pick = 0,
): SolveResult {
  const s = cloneState(split);
  s.faceM = transformsFromAngles(s, root, (e) => (folded(e) ? Math.PI : 0));
  checkFlatConsistent(s);
  const own = constraints(s);

  const coords = s.cp.vertices.map((_, v) => vertexModel(s, s.cp.faces.findIndex((loop) => loop.includes(v)), v));
  const ef = edgeFaces(s.cp);
  const graph = {
    vertices_coords: coords,
    edges_vertices: s.cp.edges.map((e) => e.v),
    edges_assignment: s.cp.edges.map((e, i): Assignment => (e.a === "B" || ef[i].length < 2 ? "B" : folded(i) ? "U" : "F")),
    faces_vertices: s.cp.faces,
  };
  // Keep the order of pairs that did not move (same transform before and after).
  const ovBefore = overlapMatrix(split);
  const ovAfter = overlapMatrix(s);
  const same = (f: number) => split.faceM[f].every((x, i) => Math.abs(x - s.faceM[f][i]) < 1e-7);
  const known: Order[] = [];
  for (let i = 0; i < s.cp.faces.length; i++)
    for (let j = i + 1; j < s.cp.faces.length; j++)
      if (ovBefore[i][j] && ovAfter[i][j] && same(i) && same(j)) known.push(above(s, i, j, split.order.indexOf(i) > split.order.indexOf(j)));

  const warnings: string[] = [];
  let solution: any = null;
  for (const [orders, note] of [
    [[...own, ...known], null],
    [own, "the fold rearranges layers that did not move"],
  ] as const) {
    try {
      solution = ear.layer({ ...graph, faceOrders: orders });
      solution.faceOrders();
      if (note) warnings.push(note);
      break;
    } catch {
      solution = null;
    }
  }
  if (!solution) throw new ActionError("no valid layer order exists for this fold (the layers would have to pass through each other)");
  let orders: Order[];
  let count = 1;
  if (pick > 0) {
    const all = solution.compileAll();
    count = all.length;
    if (pick >= all.length) throw new ActionError(`solution ${pick} does not exist: ${all.length} layer arrangement(s)`);
    orders = all[pick];
  } else orders = solution.faceOrders();
  s.order = linearize(split, s, orders);
  // Mountain/valley from the final stacking; unfolded creases become F.
  ef.forEach((fs, e) => {
    if (fs.length !== 2) return;
    s.cp.edges[e].a = folded(e) ? creaseAssignment(s, fs[0], fs[1]) : "F";
  });
  s.heights = computeHeights(s);
  return { after: s, solutions: count, warnings };
}

/** Faces whose model polygon a model-space segment (or line, if t-range is infinite) crosses. */
export function facesOnSegment(s: PaperState, l: Line, t0 = -Infinity, t1 = Infinity): number[] {
  return s.cp.faces
    .map((_, f) => f)
    .filter((f) => {
      const iv = lineConvexInterval(l, modelPolygon(s, f));
      return iv && Math.min(iv[1], t1) - Math.max(iv[0], t0) > 1e-7;
    });
}

/**
 * Layer of each listed face as seen from the viewer: 0 for the top layer, else one more than the
 * deepest overlapping listed face above it (pieces of one layer share a rank).
 */
export function layerRanks(s: PaperState, faces: number[]): Map<number, number> {
  const polys = new Map(faces.map((f) => [f, modelPolygon(s, f)]));
  const seen: number[] = [];
  const rank = new Map<number, number>();
  for (const f of viewTopFirst(s)) {
    if (!polys.has(f)) continue;
    let r = 0;
    for (const g of seen) if (convexIntersectionArea(polys.get(f)!, polys.get(g)!) > AREA_TOL) r = Math.max(r, rank.get(g)! + 1);
    rank.set(f, r);
    seen.push(f);
  }
  return rank;
}

/** A crease of a compound fold, in view coordinates. */
export interface CreaseLine {
  a: Vec2;
  b: Vec2;
  /** Only crease faces of these layer ranks (0 = top as seen); all by default. */
  ranks?: number[];
  /** Restrict to these faces (by id, before splitting). */
  faces?: Set<number>;
  /** Wanted type as seen on the upper face; "U" leaves it to the solver; "F" unfolds the crease. */
  type: "V" | "M" | "U" | "F";
  /** For a symmetric flap: layers below the top one get the opposite type (crimps). */
  mirrorLower?: boolean;
}

export interface CreaseResult {
  split: PaperState;
  /** Edge id → wanted type (V/M/U/F) for edges on the given crease segments. */
  wanted: Map<number, CreaseLine["type"]>;
  /** Edge id → layer rank of the crease (0 = top). */
  rank: Map<number, number>;
}

/**
 * Splits the selected faces along each crease line and returns which new/existing edges lie on
 * the crease segments. Faces are split along the whole line (extra flat creases are harmless).
 */
export function placeCreases(state: PaperState, creases: CreaseLine[]): CreaseResult {
  const s = cloneState(state);
  const wanted = new Map<number, CreaseLine["type"]>();
  const rank = new Map<number, number>();
  for (const c of creases) {
    const a = viewToModel(state, c.a);
    const b = viewToModel(state, c.b);
    const l = lineThrough(a, b);
    const t1 = dot(sub(b, a), l.d);
    let faces = facesOnSegment(s, l, 0, t1).filter((f) => !c.faces || c.faces.has(f));
    if (c.ranks) {
      const r = layerRanks(s, faces);
      faces = faces.filter((f) => c.ranks!.includes(r.get(f)!));
    }
    if (!faces.length) throw new ActionError("a crease of this fold does not cross the selected paper");
    const ranks = layerRanks(s, faces);
    for (const f of faces) {
      const g = splitStateFace(s, f, l);
      if (g !== null) ranks.set(g, ranks.get(f)!);
    }
    // Edges lying on the segment, belonging to the creased faces (or their new halves).
    const ef = edgeFaces(s.cp);
    s.cp.edges.forEach((e, i) => {
      if (ef[i].length !== 2 || !ef[i].some((f) => ranks.has(f))) return;
      const pts = e.v.map((v) => vertexModel(s, ef[i][0], v));
      if (!pts.every((p) => Math.abs(signedDist(l, p)) < 1e-6)) return;
      const ts = pts.map((p) => dot(sub(p, a), l.d));
      if (Math.min(...ts) < -1e-6 || Math.max(...ts) > t1 + 1e-6) return;
      const r = Math.min(...ef[i].filter((f) => ranks.has(f)).map((f) => ranks.get(f)!));
      const swap = c.mirrorLower && r > 0;
      wanted.set(i, swap ? (c.type === "V" ? "M" : c.type === "M" ? "V" : c.type) : c.type);
      rank.set(i, r);
    });
  }
  return { split: s, wanted, rank };
}

/** Tree depth of every face from the root, through shared edges. */
export function faceDepths(s: PaperState, root: number): number[] {
  const ef = edgeFaces(s.cp);
  const adj = s.cp.faces.map(() => [] as number[]);
  ef.forEach((fs) => fs.length === 2 && (adj[fs[0]].push(fs[1]), adj[fs[1]].push(fs[0])));
  const d = s.cp.faces.map(() => Infinity);
  d[root] = 0;
  const q = [root];
  while (q.length) {
    const f = q.shift()!;
    for (const g of adj[f]) if (d[g] === Infinity) (d[g] = d[f] + 1), q.push(g);
  }
  return d;
}

/**
 * Constraints for creases with a wanted type as seen. "As seen" refers to the upper of the two
 * faces before the fold (for a flat crease both show the same side). The crease-pattern
 * assignment that gives that look is fixed, and creaseAssignment() (V iff "g above f" equals
 * "f shows its front up") turns it into an order between the two faces.
 */
export function typeConstraints(before: PaperState, s: PaperState, wanted: Map<number, CreaseLine["type"]>): Order[] {
  const ef = edgeFaces(s.cp);
  const topFirst = viewTopFirst(before);
  const out: Order[] = [];
  wanted.forEach((type, e) => {
    if (type !== "V" && type !== "M") return;
    const [x, y] = ef[e];
    const f = topFirst.indexOf(x) <= topFirst.indexOf(y) ? x : y; // upper face before
    const g = f === x ? y : x;
    const seenFront = faceUp(before, f) * viewUp(before) > 0;
    const cp = seenFront ? type : type === "V" ? "M" : "V";
    out.push(above(s, g, f, (cp === "V") === faceUp(s, f) > 0));
  });
  return out;
}

/** The largest face not touching any of the given edges (it can stay in place). */
export function stationaryRoot(s: PaperState, edges: Iterable<number>, avoid: Set<number> = new Set()): number {
  const ef = edgeFaces(s.cp);
  const touched = new Set([...edges].flatMap((e) => ef[e]));
  const area = (f: number) => Math.abs(polygonArea(modelPolygon(s, f)));
  const all = s.cp.faces.map((_, f) => f).filter((f) => !avoid.has(f));
  const free = all.filter((f) => !touched.has(f));
  return (free.length ? free : all).sort((a, b) => area(b) - area(a))[0];
}

/** Is edge e folded (±180°) in state s? */
export const isFolded = (s: PaperState, e: number) => s.cp.edges[e].a === "V" || s.cp.edges[e].a === "M";

export { viewLineToModel };
