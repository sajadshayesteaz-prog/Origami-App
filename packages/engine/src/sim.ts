import { edgeFaces, type CP } from "./cp";
import type { Vec3 } from "./mat";

/**
 * Bar-and-hinge model of the paper (the method behind Origami Simulator: Schenk & Guest,
 * Ghassaei et al.), written for our engine and solved with position-based projection.
 *
 * The paper is a triangle mesh on the CP vertices, so neighbouring faces always share their
 * vertices: the sheet can bend or stretch slightly, but it can never come apart.
 * - bars: every triangle edge keeps its crease-pattern length;
 * - facet hinges: the diagonals inside a face keep the face flat (target 0);
 * - crease hinges: each crease is driven toward a target fold angle.
 */

interface Hinge {
  /** Hinge edge p0 → p1; p2 is the third vertex of the triangle on its left (in CP), p3 on its right. */
  v: [number, number, number, number];
  /** Index into cp.edges for creases, -1 for facet diagonals. */
  edge: number;
}

export interface Mesh {
  rest: number[][]; // CP coordinates
  bars: [number, number, number][]; // i, j, rest length
  hinges: Hinge[];
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function buildMesh(cp: CP): Mesh {
  const tris: [number, number, number][] = [];
  const hinges: Hinge[] = [];
  const ef = edgeFaces(cp);
  // Fan triangulation of each (convex, counter-clockwise) face; facet hinges on the fan diagonals.
  const faceTris = cp.faces.map((loop) => {
    const ts: [number, number, number][] = [];
    for (let k = 1; k + 1 < loop.length; k++) ts.push([loop[0], loop[k], loop[k + 1]]);
    for (let k = 1; k + 2 < loop.length; k++) {
      // Diagonal loop[0] → loop[k+1]: left triangle (…, k, k+1), right triangle (…, k+1, k+2).
      hinges.push({ v: [loop[0], loop[k + 1], loop[k], loop[k + 2]], edge: -1 });
    }
    tris.push(...ts);
    return ts;
  });
  const left = (p0: number, p1: number, p: number) => {
    const [a, b, c] = [cp.vertices[p0], cp.vertices[p1], cp.vertices[p]];
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
  };
  const third = (f: number, a: number, b: number) => {
    const t = faceTris[f].find((t) => t.includes(a) && t.includes(b))!;
    return t.find((v) => v !== a && v !== b)!;
  };
  cp.edges.forEach((e, i) => {
    if (ef[i].length !== 2) return;
    const [p0, p1] = e.v;
    const x = third(ef[i][0], p0, p1);
    const y = third(ef[i][1], p0, p1);
    hinges.push({ v: left(p0, p1, x) ? [p0, p1, x, y] : [p0, p1, y, x], edge: i });
  });
  const seen = new Set<string>();
  const bars: [number, number, number][] = [];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const [i, j] = [t[k], t[(k + 1) % 3]];
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = [cp.vertices[i], cp.vertices[j]];
      bars.push([i, j, Math.hypot(a[0] - b[0], a[1] - b[1])]);
    }
  return { rest: cp.vertices.map((v) => [v[0], v[1]]), bars, hinges };
}

/**
 * Signed fold angle of a hinge: 0 when flat, positive for a valley (the right triangle turns
 * toward the paper's front, CP +z, of the left one), ±π when folded flat.
 */
export function hingeAngle(p: Vec3[], h: Hinge): number {
  const [p0, p1, p2, p3] = h.v.map((i) => p[i]);
  const e = sub3(p1, p0);
  const nA = cross3(e, sub3(p2, p0));
  const nB = cross3(sub3(p0, p1), sub3(p3, p1));
  const len = Math.hypot(e[0], e[1], e[2]) || 1;
  const s = dot3(cross3(nB, nA), e) / len;
  return Math.atan2(s, dot3(nA, nB));
}

/** The representative of `a` (mod 2π) nearest to `ref`, so angles pass ±π continuously. */
const unwrap = (a: number, ref: number) => a + 2 * Math.PI * Math.round((ref - a) / (2 * Math.PI));

export interface SolveOptions {
  iterations: number;
  barPasses: number;
  creaseStiffness: number;
  facetStiffness: number;
}

/**
 * Projects positions toward the constraints for the given crease targets.
 * `angles` holds each hinge's current unwrapped angle and is updated in place.
 * Pinned vertices do not move.
 */
export function relax(mesh: Mesh, p: Vec3[], target: (edge: number) => number, angles: number[], pinned: Set<number>, o: SolveOptions) {
  const h = 1e-6;
  for (let it = 0; it < o.iterations; it++) {
    mesh.hinges.forEach((hg, k) => {
      const goal = hg.edge < 0 ? 0 : target(hg.edge);
      const stiff = hg.edge < 0 ? o.facetStiffness : o.creaseStiffness;
      const theta = unwrap(hingeAngle(p, hg), angles[k]);
      angles[k] = theta;
      const c = theta - goal;
      if (Math.abs(c) < 1e-9) return;
      // Numerical gradient of the angle with respect to the four vertices.
      const grads: Vec3[] = [];
      let norm = 0;
      for (const vi of hg.v) {
        const g: Vec3 = [0, 0, 0];
        if (!pinned.has(vi))
          for (let d = 0; d < 3; d++) {
            const keep = p[vi][d];
            p[vi][d] = keep + h;
            const up = unwrap(hingeAngle(p, hg), theta);
            p[vi][d] = keep - h;
            const dn = unwrap(hingeAngle(p, hg), theta);
            p[vi][d] = keep;
            g[d] = (up - dn) / (2 * h);
          }
        grads.push(g);
        norm += dot3(g, g);
      }
      if (norm < 1e-12) return;
      const scale = (-stiff * c) / norm;
      hg.v.forEach((vi, j) => {
        if (pinned.has(vi)) return;
        for (let d = 0; d < 3; d++) p[vi][d] += scale * grads[j][d];
      });
    });
    for (let pass = 0; pass < o.barPasses; pass++)
      for (const [i, j, rest] of mesh.bars) {
        const d = sub3(p[j], p[i]);
        const l = Math.hypot(d[0], d[1], d[2]) || 1e-12;
        const wi = pinned.has(i) ? 0 : 1;
        const wj = pinned.has(j) ? 0 : 1;
        if (wi + wj === 0) continue;
        const corr = (l - rest) / l / (wi + wj);
        for (let k = 0; k < 3; k++) {
          p[i][k] += wi * corr * d[k];
          p[j][k] -= wj * corr * d[k];
        }
      }
  }
}
