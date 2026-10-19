import { bird as birdBase } from "rabbit-ear/fold/bases.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { edgeFaces, facePolygon } from "../src/cp";
import { pointInConvex, polygonCentroid } from "../src/geom";
import { applyPoint, type Mat4 } from "../src/mat";
import { restFrame, type Frame, type Motion } from "../src/motion";
import { runPackage, type ModelPackage } from "../src/package";
import { overlapMatrix, type PaperState } from "../src/state";

const root = join(__dirname, "..", "..", "..");
const library = join(root, "data", "library");
const load = (id: string): ModelPackage => JSON.parse(readFileSync(join(library, id, "model.json"), "utf8"));
const ids = readdirSync(library);

/** A motion frame's face vertices in view space. */
const placed = (fr: Frame, f: number) => fr.faces[f].map((q) => applyPoint(fr.view as Mat4, q));

/** CP points placed by a rested state's face f (rigid transform + layer offset), in view space. */
const placedRest = (s: PaperState, f: number, pts: number[][]) =>
  pts.map((p) => applyPoint(s.view, applyPoint(s.faceM[f], [p[0], p[1], 0]))).map((q) => [q[0], q[1], q[2]]);

/** Max distance between two placements of the same points. */
const gap = (a: number[][], b: number[][]) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2])));

/**
 * Continuity: a motion's first frame must place every face exactly where the previous state
 * placed the face it came from (faces may have been split), and its last frame must equal the
 * new state's rest frame. Offsets are left out so the comparison is about the paper itself.
 */
function checkMotionEnds(prev: PaperState, m: Motion) {
  const s = m.state;
  const f0 = m.frame(0, false);
  const f1 = m.frame(1, false);
  const rest1 = restFrame(s, false);
  let worst = 0;
  s.cp.faces.forEach((_, f) => {
    const pts = facePolygon(s.cp, f);
    const c = polygonCentroid(pts);
    const parent = prev.cp.faces.findIndex((__, g) => pointInConvex(facePolygon(prev.cp, g), c, 1e-9));
    expect(parent).toBeGreaterThanOrEqual(0);
    worst = Math.max(worst, gap(placed(f0, f), placedRest(prev, parent, pts)));
    worst = Math.max(worst, gap(placed(f1, f), placed(rest1, f)));
  });
  return worst;
}

/** Largest separation, over sampled times, between the two faces' copies of any shared CP vertex. */
function maxTear(m: Motion, samples = 24) {
  const s = m.state;
  const ef = edgeFaces(s.cp);
  let worst = 0;
  for (let i = 1; i < samples; i++) {
    const fr = m.frame(i / samples, false);
    ef.forEach((fs, e) => {
      if (fs.length !== 2) return;
      for (const v of s.cp.edges[e].v) {
        const a = fr.faces[fs[0]][s.cp.faces[fs[0]].indexOf(v)];
        const b = fr.faces[fs[1]][s.cp.faces[fs[1]].indexOf(v)];
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    });
  }
  return worst;
}

describe.each(ids)("package %s", (id) => {
  const pkg = load(id);
  const run = runPackage(pkg);

  it("runs every step without errors", () => {
    for (const s of run.steps) expect(s.error, `step ${s.step.label}`).toBeUndefined();
  });

  it("every transition starts exactly at the previous end state and ends at the new state", () => {
    for (const s of run.steps) {
      let prev = s.before;
      for (const m of s.motions) {
        expect(checkMotionEnds(prev, m), `step ${s.step.label} ${m.kind}`).toBeLessThan(1e-9);
        prev = m.state;
      }
    }
  });

  it("the paper never comes apart during any motion", () => {
    for (const s of run.steps) {
      for (const m of s.motions) expect(maxTear(m), `step ${s.step.label} ${m.kind}`).toBeLessThan(1e-9);
    }
  });

  it("flat states: overlapping faces never share a rendering layer (no z-fighting)", () => {
    for (const s of run.steps) {
      const st = s.after;
      const ov = overlapMatrix(st);
      for (let i = 0; i < ov.length; i++)
        for (let j = i + 1; j < ov.length; j++) if (ov[i][j]) expect(st.heights[i], `step ${s.step.label} faces ${i},${j}`).not.toBe(st.heights[j]);
      // Stacking order agrees with heights.
      for (let i = 0; i < ov.length; i++)
        for (let j = 0; j < ov.length; j++)
          if (ov[i][j] && st.order.indexOf(i) < st.order.indexOf(j)) expect(st.heights[i]).toBeLessThan(st.heights[j]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Bird base crease pattern vs. the samples.

type Seg = { a: [number, number]; b: [number, number]; t: string };

/** Maximal collinear crease segments per assignment (boundary excluded). */
function segments(V: number[][], E: number[][], A: string[], keep: (a: string) => boolean): Seg[] {
  const groups = new Map<string, { t0: number; t1: number; d: [number, number]; c: number; asg: string }[]>();
  E.forEach(([i, j], k) => {
    const asg = A[k];
    if (!keep(asg)) return;
    const [p, q] = [V[i], V[j]];
    let dx = q[0] - p[0];
    let dy = q[1] - p[1];
    const L = Math.hypot(dx, dy);
    dx /= L;
    dy /= L;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) [dx, dy] = [-dx, -dy];
    const c = -dy * p[0] + dx * p[1];
    const key = `${dx.toFixed(6)},${dy.toFixed(6)},${c.toFixed(6)},${asg}`;
    const t = [p[0] * dx + p[1] * dy, q[0] * dx + q[1] * dy].sort((x, y) => x - y);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ t0: t[0], t1: t[1], d: [dx, dy], c, asg });
  });
  const out: Seg[] = [];
  for (const iv of groups.values()) {
    iv.sort((x, y) => x.t0 - y.t0);
    let cur = { ...iv[0] };
    const flush = () => {
      const P = (t: number): [number, number] => [cur.d[0] * t - cur.d[1] * cur.c, cur.d[1] * t + cur.d[0] * cur.c];
      out.push({ a: P(cur.t0), b: P(cur.t1), t: cur.asg });
    };
    for (const x of iv.slice(1)) {
      if (x.t0 <= cur.t1 + 1e-6) cur.t1 = Math.max(cur.t1, x.t1);
      else {
        flush();
        cur = { ...x };
      }
    }
    flush();
  }
  return out;
}

const SYMMETRIES: ((p: [number, number]) => [number, number])[] = [
  ([x, y]) => [x, y],
  ([x, y]) => [1 - y, x],
  ([x, y]) => [1 - x, 1 - y],
  ([x, y]) => [y, 1 - x],
  ([x, y]) => [1 - x, y],
  ([x, y]) => [x, 1 - y],
  ([x, y]) => [y, x],
  ([x, y]) => [1 - y, 1 - x],
];
const segKey = (s: Seg) => {
  const z = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4); // no "-0.0000"
  const r = (p: [number, number]) => `${z(p[0])},${z(p[1])}`;
  const [u, v] = [r(s.a), r(s.b)].sort();
  return `${u}|${v}|${s.t}`;
};
const SWAP: Record<string, string> = { M: "V", V: "M" };

/** The symmetry (square symmetry × optional M/V swap, i.e. paper turned over) mapping x onto y, if any. */
function matchUpToSymmetry(x: Seg[], y: Seg[]) {
  const ky = new Set(y.map(segKey));
  for (const [i, g] of SYMMETRIES.entries())
    for (const swap of [false, true]) {
      const kx = x.map((s) => segKey({ a: g(s.a), b: g(s.b), t: swap ? (SWAP[s.t] ?? s.t) : s.t }));
      if (kx.length === ky.size && kx.every((k) => ky.has(k))) return { symmetry: i, swap };
    }
  return null;
}

describe("bird base crease pattern", () => {
  const run = runPackage(load("bird-base"));
  const cp = run.final.cp;
  const V = cp.vertices;
  const E = cp.edges.map((e) => e.v);
  const A = cp.edges.map((e) => e.a);
  const folded = (asg: string[]) => segments(V, E, asg, (a) => a === "M" || a === "V");

  it("equals Rabbit Ear's flat bird base (folded creases, up to symmetry)", () => {
    const b = birdBase();
    const match = matchUpToSymmetry(folded(A), segments(b.vertices_coords, b.edges_vertices, b.edges_assignment, (a) => a === "M" || a === "V"));
    expect(match).not.toBeNull();
  });

  it("equals the bird base CP in sources/samples up to symmetry", () => {
    const sample = JSON.parse(readFileSync(join(root, "app", "public", "samples", "bird-base-3d-cp.fold"), "utf8"));
    const sV = sample.vertices_coords as number[][];
    const sE = sample.edges_vertices as number[][];
    const sA = sample.edges_assignment as string[];
    const onDiagonal = (P: number[][], e: number[]) =>
      e.every((v) => Math.abs(P[v][0] - P[v][1]) < 1e-9) || e.every((v) => Math.abs(P[v][0] + P[v][1] - 1) < 1e-9);
    // 1. Same crease lines: our folded creases plus the two unfolded diagonal halves.
    const ourLines = segments(V, E, A.map((a, i) => (a === "M" || a === "V" || (a === "F" && onDiagonal(V, E[i])) ? "C" : a)), (a) => a === "C");
    const sampleLines = segments(sV, sE, sA.map((a) => (a === "M" || a === "V" ? "C" : a)), (a) => a === "C");
    expect(matchUpToSymmetry(ourLines, sampleLines)).not.toBeNull();
    // 2. Same mountain/valley on every crease except the diagonals. The sample is a partly
    //    opened 3D bird base (all four diagonal halves at +16°, not flat-foldable at the centre);
    //    in the flat base two diagonal halves are unfolded and two are folded.
    const ourMV = segments(V, E, A.map((a, i) => (onDiagonal(V, E[i]) ? "x" : a)), (a) => a === "M" || a === "V");
    const sampleMV = segments(sV, sE, sA.map((a, i) => (onDiagonal(sV, sE[i]) ? "x" : a)), (a) => a === "M" || a === "V");
    expect(matchUpToSymmetry(ourMV, sampleMV)).not.toBeNull();
  });
});
