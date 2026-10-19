import { assignmentAngle } from "./collapse";
import type { FoldResult } from "./fold";
import { applyPoint, multiply, rotationAbout, translation, type Mat4, type Vec3 } from "./mat";
import { buildMesh, relax } from "./sim";
import type { PaperState } from "./state";

/** Gap between stacked layers when rendering, in paper units (paper size = 1). */
export const LAYER_GAP = 0.002;

/**
 * Paper at one instant: for every face, the model-space positions of its CP vertices (in the
 * face's loop order, including the layer offset), and the model → view rotation.
 */
export interface Frame {
  faces: Vec3[][];
  view: Mat4;
}

/**
 * The movement of one action (core-design §7). `state` gives the faces being moved (its CP);
 * frame(0) is exactly the previous state and frame(1) exactly the new one.
 * With `offsets = false` the layer offsets are left out (used to check the paper never tears).
 */
export interface Motion {
  kind: string;
  state: PaperState;
  frame(t: number, offsets?: boolean): Frame;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lift = (z: number, m: Mat4) => multiply(translation(0, 0, z), m);
const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Face vertex positions from one rigid transform per face. */
function placeFaces(s: PaperState, matrices: Mat4[]): Vec3[][] {
  return s.cp.faces.map((loop, f) => loop.map((v) => applyPoint(matrices[f], [s.cp.vertices[v][0], s.cp.vertices[v][1], 0])));
}

/** A state shown still (also the end/start pose of every motion). */
export function restFrame(s: PaperState, offsets = true): Frame {
  return { faces: placeFaces(s, s.faceM.map((m, f) => lift(offsets ? s.heights[f] * LAYER_GAP : 0, m))), view: s.view };
}

/** Valley/mountain: the moving stack turns rigidly about the hinge; stacking heights blend. */
export function foldMotion(r: FoldResult): Motion {
  const { split, folded, hinge, side, dir } = r;
  const moving = new Set(r.moving);
  // Axis m × z, with m the in-plane normal toward the moving side: positive angles lift toward +z.
  const m = [-hinge.d[1] * side, hinge.d[0] * side];
  const axis: Vec3 = [m[1], -m[0], 0];
  const n = Math.hypot(axis[0], axis[1]);
  const unit: Vec3 = [axis[0] / n, axis[1] / n, 0];
  const point: Vec3 = [hinge.p[0], hinge.p[1], 0];
  return {
    kind: "fold",
    state: folded,
    frame(t, offsets = true) {
      const R = rotationAbout(point, unit, dir * Math.PI * t);
      const k = offsets ? LAYER_GAP : 0;
      const matrices = split.faceM.map((M, f) => {
        const h0 = split.heights[f] * k;
        const h1 = folded.heights[f] * k;
        // Moving faces: start at h0, and end at h1 after the half turn (which maps z to -z).
        if (moving.has(f)) return multiply(R, lift(lerp(h0, -h1, t), M));
        return lift(lerp(h0, h1, t), M);
      });
      return { faces: placeFaces(folded, matrices), view: split.view };
    },
  };
}

/** Fold and unfold: fold to 180° and back; ends where it started, with the new crease. */
export function foldUnfoldMotion(r: FoldResult, end: PaperState): Motion {
  const fold = foldMotion(r);
  return {
    kind: "foldUnfold",
    state: end,
    frame(t, offsets = true) {
      return fold.frame(t < 0.5 ? 2 * t : 2 - 2 * t, offsets);
    },
  };
}

/** Collapse simulation settings: samples of the path, solver iterations per sample, and where it hands over to the exact end. */
export const COLLAPSE_SIM = { samples: 60, iterations: 40, barPasses: 4, creaseStiffness: 0.3, facetStiffness: 0.9, handover: 0.95 };

/**
 * Collapse: the paper is moved as one connected bar-and-hinge mesh (sim.ts) while every crease
 * is driven from its old to its new angle, with one face held still. The simulated path is
 * sampled once; near the end it blends into the exactly solved flat state. Vertices are shared
 * between faces, so the paper never comes apart; faces may flex slightly mid-move.
 */
export function collapseMotion(
  before: PaperState,
  after: PaperState,
  root: number,
  schedule: (a0: number, a1: number, t: number) => number = (a0, a1, t) => lerp(a0, a1, t),
  kind = "collapse",
): Motion {
  const cp = after.cp;
  const vertexPositions = (s: PaperState): Vec3[] =>
    cp.vertices.map((v, i) => {
      const f = cp.faces.findIndex((loop) => loop.includes(i));
      return applyPoint(s.faceM[f], [v[0], v[1], 0]);
    });
  const a0 = before.cp.edges.map((e) => assignmentAngle(e.a));
  const a1 = after.cp.edges.map((e) => assignmentAngle(e.a));
  const start = vertexPositions(before);
  const end = vertexPositions(after);
  let samples: Vec3[][] | null = null;
  const simulate = () => {
    const mesh = buildMesh(cp);
    const pinned = new Set(cp.faces[root]);
    const p = start.map((q) => [...q] as Vec3);
    const angles = mesh.hinges.map((h) => (h.edge < 0 ? 0 : a0[h.edge]));
    const out = [start.map((q) => [...q] as Vec3)];
    const o = COLLAPSE_SIM;
    for (let i = 1; i <= o.samples; i++) {
      const tt = i / o.samples;
      relax(mesh, p, (e) => schedule(a0[e], a1[e], tt), angles, pinned, o);
      out.push(p.map((q) => [...q] as Vec3));
    }
    return out;
  };
  return {
    kind,
    state: after,
    frame(t, offsets = true) {
      let pos: Vec3[];
      if (t <= 0) pos = start;
      else if (t >= 1) pos = end;
      else {
        samples ??= simulate();
        const n = COLLAPSE_SIM.samples;
        const x = t * n;
        const i = Math.min(Math.floor(x), n - 1);
        const u = x - i;
        const w = smoothstep((t - COLLAPSE_SIM.handover) / (1 - COLLAPSE_SIM.handover));
        pos = samples[i].map((q, v) => {
          const r = samples![i + 1][v];
          const sim: Vec3 = [lerp(q[0], r[0], u), lerp(q[1], r[1], u), lerp(q[2], r[2], u)];
          return [lerp(sim[0], end[v][0], w), lerp(sim[1], end[v][1], w), lerp(sim[2], end[v][2], w)];
        });
      }
      const faces = cp.faces.map((loop, f) => {
        const z = offsets ? lerp(before.heights[f], after.heights[f], t) * LAYER_GAP : 0;
        return loop.map((v) => [pos[v][0], pos[v][1], pos[v][2] + z] as Vec3);
      });
      return { faces, view: before.view };
    },
  };
}

/**
 * Two-phase schedule for compound folds: first, creases that change direction open to flat and
 * new creases fold halfway (the layers open); then everything goes to its final angle (push and
 * close). For a reverse fold this reads as "open the layers → push the point in → close".
 */
export function twoPhase(a0: number, a1: number, t: number): number {
  const flip = a0 !== 0 && a1 !== 0 && Math.sign(a0) !== Math.sign(a1);
  const mid = flip ? 0 : a0 === 0 ? 0.5 * a1 : a1 === 0 ? 0.5 * a0 : a0;
  return t <= 0.5 ? lerp(a0, mid, t / 0.5) : lerp(mid, a1, (t - 0.5) / 0.5);
}

/** Motion of a compound fold: connected (bar-and-hinge) and in two phases. */
export const phasedMotion = (before: PaperState, after: PaperState, root: number, kind: string) => collapseMotion(before, after, root, twoPhase, kind);

/** Turn over / rotate: the whole model turns in view space. */
export function viewMotion(before: PaperState, after: PaperState, axis: Vec3, angle: number, kind: string): Motion {
  return {
    kind,
    state: after,
    frame(t, offsets = true) {
      const view = t >= 1 ? after.view : multiply(rotationAbout([0, 0, 0], axis, angle * t), before.view);
      return { faces: restFrame(before, offsets).faces, view };
    },
  };
}

/** No movement (zoom, L0 steps). */
export function stillMotion(s: PaperState, kind = "still"): Motion {
  return { kind, state: s, frame: (_t, offsets = true) => restFrame(s, offsets) };
}
