import { transformsFromAngles, assignmentAngle } from "./collapse";
import type { FoldResult } from "./fold";
import { multiply, rotationAbout, translation, type Mat4, type Vec3 } from "./mat";
import type { PaperState } from "./state";

/** Gap between stacked layers when rendering, in paper units (paper size = 1). */
export const LAYER_GAP = 0.002;

/** Face placements at one instant: per face CP → model (including layer offset), and model → view. */
export interface Frame {
  model: Mat4[];
  view: Mat4;
}

/**
 * The movement of one action (core-design §7). `state` gives the faces being moved (its CP);
 * frame(0) is exactly the previous state and frame(1) exactly the new one.
 */
export interface Motion {
  kind: string;
  state: PaperState;
  frame(t: number): Frame;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lift = (z: number, m: Mat4) => multiply(translation(0, 0, z), m);

/** A state shown still (also the end/start pose of every motion). */
export function restFrame(s: PaperState): Frame {
  return { model: s.faceM.map((m, f) => lift(s.heights[f] * LAYER_GAP, m)), view: s.view };
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
    frame(t) {
      const R = rotationAbout(point, unit, dir * Math.PI * t);
      const model = split.faceM.map((M, f) => {
        const h0 = split.heights[f] * LAYER_GAP;
        const h1 = folded.heights[f] * LAYER_GAP;
        // Moving faces: start at h0, and end at h1 after the half turn (which maps z to -z).
        if (moving.has(f)) return multiply(R, lift(lerp(h0, -h1, t), M));
        return lift(lerp(h0, h1, t), M);
      });
      return { model, view: split.view };
    },
  };
}

/** Fold and unfold: fold to 180° and back; ends where it started, with the new crease. */
export function foldUnfoldMotion(r: FoldResult, end: PaperState): Motion {
  const fold = foldMotion(r);
  return {
    kind: "foldUnfold",
    state: end,
    frame(t) {
      return fold.frame(t < 0.5 ? 2 * t : 2 - 2 * t);
    },
  };
}

/** Collapse: every crease angle moves from its old to its new value; one face stays fixed. */
export function collapseMotion(before: PaperState, after: PaperState, root: number): Motion {
  const a0 = before.cp.edges.map((e) => assignmentAngle(e.a));
  const a1 = after.cp.edges.map((e) => assignmentAngle(e.a));
  return {
    kind: "collapse",
    state: after,
    frame(t) {
      const placed = t <= 0 ? before.faceM : t >= 1 ? after.faceM : transformsFromAngles(before, root, (e) => lerp(a0[e], a1[e], t));
      const model = placed.map((M, f) => lift(lerp(before.heights[f], after.heights[f], t) * LAYER_GAP, M));
      return { model, view: before.view };
    },
  };
}

/** Turn over / rotate: the whole model turns in view space. */
export function viewMotion(before: PaperState, after: PaperState, axis: Vec3, angle: number, kind: string): Motion {
  const rest = restFrame(before);
  return {
    kind,
    state: after,
    frame(t) {
      const view = t >= 1 ? after.view : multiply(rotationAbout([0, 0, 0], axis, angle * t), before.view);
      return { model: rest.model, view };
    },
  };
}

/** No movement (zoom, L0 steps). */
export function stillMotion(s: PaperState, kind = "still"): Motion {
  const rest = restFrame(s);
  return { kind, state: s, frame: () => rest };
}
