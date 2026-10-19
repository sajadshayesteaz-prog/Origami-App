import type { Mark } from "./actions";
import { above, isFolded, layerRanks, placeCreases, solveFromMask, stationaryRoot, typeConstraints, type CreaseLine, type Order } from "./compound";
import { edgeFaces } from "./cp";
import { ActionError } from "./errors";
import { prepareFold, type LayerSel } from "./fold";
import {
  add,
  dist,
  dot,
  intersectLines,
  lineConvexInterval,
  lineThrough,
  normalize,
  perp,
  polygonCentroid,
  reflectPoint,
  scale,
  signedDist,
  sub,
  type Line,
  type Vec2,
} from "./geom";
import { phasedMotion, type Motion } from "./motion";
import { resolveLine, resolvePoint, type LineRef, type PointRef } from "./refs";
import { faceUp, modelPolygon, modelToView, overlapMatrix, viewToModel, viewTopFirst, viewUp, type PaperState } from "./state";

/** Compound actions (core-design §5.5); specs in docs/action-language.md §6. */
export type CompoundAction =
  | { op: "insideReverse" | "outsideReverse"; flap: PointRef; line: LineRef; layers?: LayerSel; text?: string }
  | { op: "squash"; flap: PointRef; line: LineRef; text?: string }
  | { op: "petal"; tip: PointRef; text?: string }
  | { op: "rabbitEar" | "doubleRabbitEar"; corner: PointRef; from: [PointRef, PointRef]; toward?: PointRef; text?: string }
  | { op: "swivel"; valley: LineRef; swivel: LineRef; text?: string }
  | { op: "pleat"; valley: LineRef; mountain: LineRef; text?: string }
  | { op: "crimp"; flap: PointRef; valley: LineRef; mountain: LineRef; text?: string }
  | { op: "sinkOpen" | "sinkClosed"; tip: PointRef; line: LineRef; text?: string }
  | { op: "spreadSquash"; tip: PointRef; spine: LineRef; lines: [LineRef, LineRef]; text?: string };

export const COMPOUND_OPS = new Set([
  "insideReverse",
  "outsideReverse",
  "squash",
  "petal",
  "rabbitEar",
  "doubleRabbitEar",
  "swivel",
  "pleat",
  "crimp",
  "sinkOpen",
  "sinkClosed",
  "spreadSquash",
]);

export interface CompoundResult {
  after: PaperState;
  motion: Motion;
  mark: Mark;
  warnings: string[];
}

const unit = (l: Line): Line => ({ p: l.p, d: normalize(l.d) });

/** The part of a view line inside the paper (all faces), as a segment. */
function lineOnPaper(s: PaperState, l: Line): [Vec2, Vec2] {
  let t0 = Infinity;
  let t1 = -Infinity;
  s.cp.faces.forEach((_, f) => {
    const iv = lineConvexInterval(l, modelPolygon(s, f).map((p) => modelToView(s, p)));
    if (iv) [t0, t1] = [Math.min(t0, iv[0]), Math.max(t1, iv[1])];
  });
  if (!(t1 > t0)) throw new ActionError("the line does not cross the paper");
  return [add(l.p, scale(l.d, t0)), add(l.p, scale(l.d, t1))];
}

/** View position of the part of the paper that moves (largest moving face), for arrows. */
function movingCentroid(s: PaperState, faces: Iterable<number>): Vec2 {
  let best: Vec2 | null = null;
  let bestArea = -1;
  for (const f of faces) {
    const poly = modelPolygon(s, f).map((p) => modelToView(s, p));
    const a = Math.abs(poly.reduce((acc, p, i) => acc + (p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1]), 0));
    if (a > bestArea) [best, bestArea] = [polygonCentroid(poly), a];
  }
  return best ?? [0, 0];
}

/** Type as seen of a crease after a fold, judged on its upper face before the fold. */
function seenType(before: PaperState, after: PaperState, e: number): "V" | "M" | "F" {
  const a = after.cp.edges[e].a;
  if (a !== "V" && a !== "M") return "F";
  const ef = edgeFaces(after.cp)[e];
  const topFirst = viewTopFirst(before);
  const f = ef.filter((x) => x < before.cp.faces.length).sort((x, y) => topFirst.indexOf(x) - topFirst.indexOf(y))[0] ?? ef[0];
  const front = faceUp(before, f) * viewUp(before) > 0;
  return front ? a : a === "V" ? "M" : "V";
}

/** Crease marks (view segments) for the diagram, with hidden ones flagged for x-ray lines. */
function creaseMarks(split: PaperState, after: PaperState, edges: Iterable<number>) {
  const ef = edgeFaces(after.cp);
  const topFirst = viewTopFirst(split);
  const out: { a: Vec2; b: Vec2; type: "V" | "M" | "F"; hidden?: boolean }[] = [];
  for (const e of edges) {
    const f = ef[e][0];
    const [p, q] = after.cp.edges[e].v.map((v) => modelToView(split, modelPos(split, f, after.cp.vertices[v])));
    const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    // Hidden (x-ray) if a face above both of the crease's faces covers its midpoint.
    const upper = Math.min(...ef[e].map((x) => topFirst.indexOf(x)));
    const covered = topFirst.slice(0, Math.max(0, upper)).some((g) => pointIn(modelPolygon(split, g).map((x) => modelToView(split, x)), mid));
    out.push({ a: p, b: q, type: seenType(split, after, e), hidden: covered || undefined });
  }
  return out;
}

/** Model position of a CP point through face f. */
const modelPos = (s: PaperState, f: number, cp: Vec2): Vec2 => {
  const m = s.faceM[f];
  return [m[0] * cp[0] + m[4] * cp[1] + m[12], m[1] * cp[0] + m[5] * cp[1] + m[13]];
};

function pointIn(poly: Vec2[], p: Vec2) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Topmost face (as seen) having a vertex at view point X. */
function facesAtPoint(s: PaperState, x: Vec2): number[] {
  return viewTopFirst(s).filter((f) => modelPolygon(s, f).some((p) => dist(modelToView(s, p), x) < 1e-6));
}

// ---------------------------------------------------------------------------------------------

function reverseFold(state: PaperState, a: { flap: PointRef; line: LineRef; layers?: LayerSel }, inside: boolean, kind: string): CompoundResult {
  const line = unit(resolveLine(state, a.line));
  const tip = resolvePoint(state, a.flap);
  const p = prepareFold(state, { line, move: a.flap, layers: a.layers ?? { flap: a.flap }, allowSplit: true });
  const s = p.split;
  const M = p.moving;
  const ef = edgeFaces(s.cp);
  const hinge = ef.map((fs, e) => [fs, e] as const).filter(([fs]) => fs.length === 2 && M.has(fs[0]) !== M.has(fs[1])).map(([, e]) => e);
  if (!hinge.length) throw new ActionError("the reverse-fold line does not cross the flap");
  const stat = hinge.map((e) => ef[e].find((f) => !M.has(f))!);
  const mov = hinge.map((e) => ef[e].find((f) => M.has(f))!);
  const ov = overlapMatrix(s);
  const root = stationaryRoot(s, hinge, M);
  const constraints = (pos: PaperState): Order[] =>
    hinge.map((_, i) => {
      const st = stat[i];
      const others = stat.filter((g) => g !== st && ov[st][g]);
      if (!others.length) throw new ActionError("a reverse fold needs a flap of two or more layers (use valley or mountain for one layer)");
      const nAbove = others.filter((g) => s.order.indexOf(g) > s.order.indexOf(st)).length;
      const innerAbove = nAbove * 2 > others.length;
      return above(pos, mov[i], st, inside ? innerAbove : !innerAbove);
    });
  const r = solveFromMask(s, (e) => isFolded(s, e) || hinge.includes(e), root, constraints);
  const from = movingCentroid(s, M);
  const seg = lineOnPaper(s, line);
  return {
    after: r.after,
    motion: phasedMotion(s, r.after, root, kind),
    mark: {
      kind: "compound",
      label: inside ? "inside reverse" : "outside reverse",
      creases: creaseMarks(s, r.after, hinge),
      line: { a: seg[0], b: seg[1], type: inside ? "V" : "M" },
      arrows: [{ from, to: reflectPoint(line, from), style: inside ? "push" : "valley" }],
      tip,
    },
    warnings: [...p.warnings, ...r.warnings],
  };
}

/** Generic: crease the given lines and fold them, with wanted types as seen. */
function creaseFold(state: PaperState, creases: CreaseLine[], kind: string, label: string, extra: (before: PaperState, pos: PaperState, wanted: Map<number, string>) => Order[] = () => [], flatten: (s: PaperState) => Set<number> = () => new Set()) {
  const { split: s, wanted } = placeCreases(state, creases);
  const unfold = flatten(s);
  for (const e of unfold) wanted.set(e, "F");
  const folded = (e: number) => (wanted.has(e) ? wanted.get(e) !== "F" : isFolded(s, e));
  const changed = [...wanted.keys()];
  const root = stationaryRoot(s, changed);
  const r = solveFromMask(s, folded, root, (pos) => [...typeConstraints(s, pos, wanted), ...extra(s, pos, wanted as Map<number, string>)]);
  return { s, r, root, changed, kind, label };
}

function finish(_state: PaperState, x: ReturnType<typeof creaseFold>, arrows: NonNullable<Extract<Mark, { kind: "compound" }>["arrows"]>, tip?: Vec2): CompoundResult {
  return {
    after: x.r.after,
    motion: phasedMotion(x.s, x.r.after, x.root, x.kind),
    mark: { kind: "compound", label: x.label, creases: creaseMarks(x.s, x.r.after, x.changed), arrows, tip },
    warnings: x.r.warnings,
  };
}

function petal(state: PaperState, a: { tip: PointRef }): CompoundResult {
  const X = resolvePoint(state, a.tip);
  const atX = facesAtPoint(state, X);
  if (!atX.length) throw new ActionError("the petal tip is not a corner of the paper as seen");
  const ranks = layerRanks(state, atX);
  const top = atX.filter((f) => ranks.get(f) === 0);
  // Flap outline at the tip: the extreme edge directions of the top layer's faces.
  const dirs: Vec2[] = [];
  const hullPts: Vec2[] = [];
  for (const f of top) {
    const poly = modelPolygon(state, f).map((p) => modelToView(state, p));
    hullPts.push(...poly);
    const i = poly.findIndex((p) => dist(p, X) < 1e-6);
    dirs.push(normalize(sub(poly[(i + 1) % poly.length], X)), normalize(sub(poly[(i + poly.length - 1) % poly.length], X)));
  }
  // The two edge directions furthest apart are the flap's raw edges.
  let [u1, u2] = [dirs[0], dirs[0]];
  let best = 2;
  for (const d1 of dirs) for (const d2 of dirs) if (dot(d1, d2) < best) [u1, u2, best] = [d1, d2, dot(d1, d2)];
  const c = normalize(add(u1, u2));
  const hull = convexHull(hullPts);
  const hit = (d: Vec2): Vec2 => {
    const iv = lineConvexInterval({ p: X, d }, hull);
    if (!iv) throw new ActionError("cannot find the petal's kite creases");
    return add(X, scale(d, iv[1]));
  };
  const p1 = hit(normalize(add(u1, c)));
  const p2 = hit(normalize(add(u2, c)));
  const x = creaseFold(
    state,
    [
      { a: X, b: p1, ranks: [0], type: "M" },
      { a: X, b: p2, ranks: [0], type: "M" },
      { a: X, b: p1, ranks: [1], type: "V" },
      { a: X, b: p2, ranks: [1], type: "V" },
    ],
    "petal",
    "petal fold",
  );
  return {
    ...finish(state, x, [{ from: X, to: reflectPoint(lineThrough(p1, p2), X), style: "valley" }], X),
    mark: { kind: "compound", label: "petal fold", creases: [...creaseMarks(x.s, x.r.after, x.changed), { a: p1, b: p2, type: "V" }], arrows: [{ from: X, to: reflectPoint(lineThrough(p1, p2), X), style: "valley" }], tip: X, line: { a: p1, b: p2, type: "V" } },
  };
}

function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function rabbitEar(state: PaperState, a: { corner: PointRef; from: [PointRef, PointRef]; toward?: PointRef }, kind: string): CompoundResult {
  const X = resolvePoint(state, a.corner);
  const Y = resolvePoint(state, a.from[0]);
  const Z = resolvePoint(state, a.from[1]);
  const [lx, ly, lz] = [dist(Y, Z), dist(X, Z), dist(X, Y)];
  const I: Vec2 = scale(add(add(scale(X, lx), scale(Y, ly)), scale(Z, lz)), 1 / (lx + ly + lz));
  const T = a.toward ? resolvePoint(state, a.toward) : Y;
  const side = lineThrough(X, T);
  const foot = add(side.p, scale(side.d, dot(sub(I, side.p), side.d)));
  const x = creaseFold(
    state,
    [
      { a: Y, b: I, type: "V" },
      { a: Z, b: I, type: "V" },
      { a: X, b: I, type: "U" },
      { a: I, b: foot, type: "U" },
    ],
    kind,
    kind === "rabbitEar" ? "rabbit ear" : "double rabbit ear",
  );
  return finish(state, x, [{ from: X, to: foot, style: "valley" }], X);
}

function sink(state: PaperState, a: { tip: PointRef; line: LineRef }, open: boolean): CompoundResult {
  const line = unit(resolveLine(state, a.line));
  const X = resolvePoint(state, a.tip);
  const p = prepareFold(state, { line, move: a.tip, layers: "all", allowSplit: true });
  const s = p.split;
  const M = p.moving;
  const ef = edgeFaces(s.cp);
  const hinge = ef.map((fs, e) => [fs, e] as const).filter(([fs]) => fs.length === 2 && M.has(fs[0]) !== M.has(fs[1])).map(([, e]) => e);
  if (!hinge.length) throw new ActionError("the sink line does not cross the point");
  const ov = overlapMatrix(s);
  const stat = hinge.map((e) => ef[e].find((f) => !M.has(f))!);
  const mov = hinge.map((e) => ef[e].find((f) => M.has(f))!);
  const root = stationaryRoot(s, hinge, M);
  const constraints = (pos: PaperState): Order[] => {
    const out: Order[] = hinge.map((_, i) => {
      const st = stat[i];
      const others = stat.filter((g) => g !== st && ov[st][g]);
      const nAbove = others.filter((g) => s.order.indexOf(g) > s.order.indexOf(st)).length;
      return above(pos, mov[i], st, nAbove * 2 > others.length);
    });
    if (!open) {
      // Closed sink: the sunk layers move as one block (their stacking is mirrored, not opened).
      const ms = [...M];
      for (let i = 0; i < ms.length; i++)
        for (let j = i + 1; j < ms.length; j++)
          if (ov[ms[i]][ms[j]]) out.push(above(pos, ms[i], ms[j], s.order.indexOf(ms[i]) < s.order.indexOf(ms[j])));
    }
    return out;
  };
  const r = solveFromMask(s, (e) => isFolded(s, e) || hinge.includes(e), root, constraints);
  const seg = lineOnPaper(s, line);
  return {
    after: r.after,
    motion: phasedMotion(s, r.after, root, open ? "sinkOpen" : "sinkClosed"),
    mark: {
      kind: "compound",
      label: open ? "open sink" : "closed sink",
      creases: creaseMarks(s, r.after, hinge),
      line: { a: seg[0], b: seg[1], type: "M" },
      arrows: [{ from: X, to: reflectPoint(line, X), style: "push" }],
      tip: X,
    },
    warnings: [...p.warnings, ...r.warnings],
  };
}

function squash(state: PaperState, a: { flap: PointRef; line: LineRef }): CompoundResult {
  const line = unit(resolveLine(state, a.line));
  const P = resolvePoint(state, a.flap);
  const side = Math.sign(signedDist(line, P));
  if (!side) throw new ActionError("the squash point lies on the fold line");
  // The flap's top face at P, and its spine: a folded edge to the layer under it, beyond the line.
  const t = viewTopFirst(state).find((f) => pointIn(modelPolygon(state, f).map((p) => modelToView(state, p)), P));
  if (t === undefined) throw new ActionError("the squash point is not on the paper");
  const ef = edgeFaces(state.cp);
  const ov = overlapMatrix(state);
  let spine: Line | null = null;
  let spineLen = 0;
  ef.forEach((fs, e) => {
    if (fs.length !== 2 || !fs.includes(t) || !isFolded(state, e)) return;
    const g = fs.find((f) => f !== t)!;
    if (!ov[t][g]) return;
    const [p, q] = state.cp.edges[e].v.map((v) => modelToView(state, modelPos(state, t, state.cp.vertices[v])));
    const midS = Math.sign(signedDist(line, scale(add(p, q), 0.5)));
    if (midS !== side) return;
    if (dist(p, q) > spineLen) [spine, spineLen] = [lineThrough(p, q), dist(p, q)];
  });
  if (!spine) throw new ActionError("a squash needs a flap of two layers joined by a fold (its spine) beyond the line");
  const S: Line = spine;
  const mirror = (q: Vec2) => reflectPoint(S, q);
  const L2 = lineThrough(mirror(line.p), mirror(add(line.p, line.d)));
  const seg1 = lineOnPaper(state, line);
  const seg2 = lineOnPaper(state, L2);
  const x = creaseFold(
    state,
    [
      { a: seg1[0], b: seg1[1], ranks: [0], type: "V" },
      { a: seg2[0], b: seg2[1], ranks: [1], type: "U" },
    ],
    "squash",
    "squash fold",
    () => [],
    (s) => {
      // The spine beyond the crossing point opens flat.
      const cross = intersectLines(S, line);
      const out = new Set<number>();
      const sm = viewToModel(state, S.p);
      const sd = sub(viewToModel(state, add(S.p, S.d)), sm);
      const lm: Line = { p: sm, d: normalize(sd) };
      edgeFaces(s.cp).forEach((fs, e) => {
        if (fs.length !== 2 || !isFolded(s, e)) return;
        const pts = s.cp.edges[e].v.map((v) => {
          const c = s.cp.vertices[v];
          const m = s.faceM[fs[0]];
          return [m[0] * c[0] + m[4] * c[1] + m[12], m[1] * c[0] + m[5] * c[1] + m[13]] as Vec2;
        });
        if (!pts.every((q) => Math.abs(signedDist(lm, q)) < 1e-6)) return;
        const midV = modelToView(s, scale(add(pts[0], pts[1]), 0.5));
        if (cross && Math.sign(signedDist(line, midV)) === side) out.add(e);
      });
      return out;
    },
  );
  return finish(state, x, [{ from: P, to: reflectPoint(line, P), style: "valley" }, { from: add(P, scale(perp(line.d), 0.05)), to: P, style: "push" }], P);
}

function crimp(state: PaperState, a: { flap: PointRef; valley: LineRef; mountain: LineRef }): CompoundResult {
  const l1 = unit(resolveLine(state, a.valley));
  const l2 = unit(resolveLine(state, a.mountain));
  const s1 = lineOnPaper(state, l1);
  const s2 = lineOnPaper(state, l2);
  const P = resolvePoint(state, a.flap);
  const x = creaseFold(
    state,
    [
      { a: s1[0], b: s1[1], ranks: [0, 1], type: "V", mirrorLower: true },
      { a: s2[0], b: s2[1], ranks: [0, 1], type: "M", mirrorLower: true },
    ],
    "crimp",
    "crimp",
  );
  return finish(state, x, [{ from: P, to: reflectPoint(l1, P), style: "push" }], P);
}

function pleat(state: PaperState, a: { valley: LineRef; mountain: LineRef }): CompoundResult {
  const l1 = unit(resolveLine(state, a.valley));
  const l2 = unit(resolveLine(state, a.mountain));
  const s1 = lineOnPaper(state, l1);
  const s2 = lineOnPaper(state, l2);
  const x = creaseFold(
    state,
    [
      { a: s1[0], b: s1[1], type: "V" },
      { a: s2[0], b: s2[1], type: "M" },
    ],
    "pleat",
    "pleat",
  );
  const m: Vec2 = scale(add(scale(add(s2[0], s2[1]), 0.5), scale(add(s1[0], s1[1]), 0.5)), 0.5);
  return finish(state, x, [{ from: scale(add(s2[0], s2[1]), 0.5), to: m, style: "valley" }]);
}

function swivel(state: PaperState, a: { valley: LineRef; swivel: LineRef }): CompoundResult {
  const l1 = unit(resolveLine(state, a.valley));
  const l2 = unit(resolveLine(state, a.swivel));
  const s1 = lineOnPaper(state, l1);
  const s2 = lineOnPaper(state, l2);
  const x = creaseFold(
    state,
    [
      { a: s1[0], b: s1[1], type: "V" },
      { a: s2[0], b: s2[1], type: "U" },
    ],
    "swivel",
    "swivel fold",
  );
  const from: Vec2 = scale(add(s1[0], s1[1]), 0.5);
  return finish(state, x, [{ from: add(from, scale(perp(l1.d), 0.15)), to: add(from, scale(perp(l1.d), -0.15)), style: "valley" }]);
}

function spreadSquash(state: PaperState, a: { tip: PointRef; spine: LineRef; lines: [LineRef, LineRef] }): CompoundResult {
  const X = resolvePoint(state, a.tip);
  const sp = unit(resolveLine(state, a.spine));
  const ls = a.lines.map((l) => unit(resolveLine(state, l)));
  const segs = ls.map((l) => lineOnPaper(state, l));
  const x = creaseFold(
    state,
    segs.map((g) => ({ a: g[0], b: g[1], type: "V" as const })),
    "spreadSquash",
    "spread squash",
    () => [],
    (s) => {
      const out = new Set<number>();
      const sm = viewToModel(state, sp.p);
      const lm: Line = { p: sm, d: normalize(sub(viewToModel(state, add(sp.p, sp.d)), sm)) };
      edgeFaces(s.cp).forEach((fs, e) => {
        if (fs.length !== 2 || !isFolded(s, e)) return;
        const pts = s.cp.edges[e].v.map((v) => {
          const c = s.cp.vertices[v];
          const m = s.faceM[fs[0]];
          return [m[0] * c[0] + m[4] * c[1] + m[12], m[1] * c[0] + m[5] * c[1] + m[13]] as Vec2;
        });
        if (pts.every((q) => Math.abs(signedDist(lm, q)) < 1e-6)) out.add(e);
      });
      return out;
    },
  );
  return finish(state, x, [{ from: X, to: add(X, scale(sp.d, -0.2)), style: "push" }], X);
}

/** Runs a compound action. */
export function applyCompound(state: PaperState, action: CompoundAction): CompoundResult {
  switch (action.op) {
    case "insideReverse":
      return reverseFold(state, action, true, "insideReverse");
    case "outsideReverse":
      return reverseFold(state, action, false, "outsideReverse");
    case "petal":
      return petal(state, action);
    case "rabbitEar":
    case "doubleRabbitEar":
      return rabbitEar(state, action, action.op);
    case "sinkOpen":
      return sink(state, action, true);
    case "sinkClosed":
      return sink(state, action, false);
    case "squash":
      return squash(state, action);
    case "crimp":
      return crimp(state, action);
    case "pleat":
      return pleat(state, action);
    case "swivel":
      return swivel(state, action);
    case "spreadSquash":
      return spreadSquash(state, action);
  }
}
