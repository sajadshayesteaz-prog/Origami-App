import { cloneCP, facePolygon, type CP } from "./cp";
import { convexIntersectionArea, AREA_TOL, pointInConvex, type Vec2 } from "./geom";
import { applyPoint, identity, invertRigid, zSign, type Mat4 } from "./mat";

/**
 * The paper after some actions (core-design §4).
 * - cp: crease pattern on the unfolded paper.
 * - faceM: per face, a rigid transform from CP (z = 0) into model space; flat states map to z = 0.
 * - order: faces from bottom to top along model +z (a linear extension of the layer order).
 * - view: model → view rotation (turn over, rotate); the viewer looks down view -z.
 */
export interface PaperState {
  cp: CP;
  faceM: Mat4[];
  order: number[];
  view: Mat4;
  zoom: [number, number, number, number] | null;
  /** Named points and lines, stored in CP coordinates so they survive later folds. */
  names: { points: Record<string, Vec2>; lines: Record<string, [Vec2, Vec2]> };
  /** Rendering layer per face: 0 + number of overlapping faces stacked below (see computeHeights). */
  heights: number[];
}

export function initialState(): PaperState {
  const cp: CP = {
    vertices: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges: [
      { v: [0, 1], a: "B" },
      { v: [1, 2], a: "B" },
      { v: [2, 3], a: "B" },
      { v: [3, 0], a: "B" },
    ],
    faces: [[0, 1, 2, 3]],
  };
  return { cp, faceM: [identity()], order: [0], view: identity(), zoom: null, names: { points: {}, lines: {} }, heights: [0] };
}

export function cloneState(s: PaperState): PaperState {
  return {
    cp: cloneCP(s.cp),
    faceM: s.faceM.map((m) => m.slice()),
    order: s.order.slice(),
    view: s.view.slice(),
    zoom: s.zoom ? [...s.zoom] : null,
    names: { points: { ...s.names.points }, lines: { ...s.names.lines } },
    heights: s.heights.slice(),
  };
}

/** Paper corners and centre in CP coordinates (A top-left, clockwise). */
export const CORNERS: Record<string, Vec2> = { A: [0, 1], B: [1, 1], C: [1, 0], D: [0, 0], O: [0.5, 0.5] };

const to2 = (p: number[]): Vec2 => [p[0], p[1]];

export function modelPolygon(s: PaperState, f: number): Vec2[] {
  return facePolygon(s.cp, f).map((p) => to2(applyPoint(s.faceM[f], [p[0], p[1], 0])));
}

/** +1 if the face shows its front (CP +z) toward model +z. */
export const faceUp = (s: PaperState, f: number) => zSign(s.faceM[f]);

/** +1 if the viewer sees model +z (not turned over). */
export const viewUp = (s: PaperState) => zSign(s.view);

export const modelToView = (s: PaperState, p: Vec2): Vec2 => to2(applyPoint(s.view, [p[0], p[1], 0]));
export const viewToModel = (s: PaperState, p: Vec2): Vec2 => to2(applyPoint(invertRigid(s.view), [p[0], p[1], 0]));

/** Faces ordered from the viewer's top to bottom. */
export const viewTopFirst = (s: PaperState) => (viewUp(s) > 0 ? s.order.slice().reverse() : s.order.slice());

/** Model position of a CP point (valid in any consistent state). */
export function cpToModel(s: PaperState, p: Vec2): Vec2 {
  const f = s.cp.faces.findIndex((_, i) => pointInConvex(facePolygon(s.cp, i), p, 1e-6));
  if (f === -1) throw new Error(`point (${p[0]}, ${p[1]}) is not on the paper`);
  return to2(applyPoint(s.faceM[f], [p[0], p[1], 0]));
}

/** CP coordinates of the topmost (as viewed) layer at a model point. */
export function modelToCP(s: PaperState, p: Vec2): Vec2 {
  for (const f of viewTopFirst(s)) {
    if (pointInConvex(modelPolygon(s, f), p, 1e-6)) return to2(applyPoint(invertRigid(s.faceM[f]), [p[0], p[1], 0]));
  }
  throw new Error(`point (${p[0].toFixed(3)}, ${p[1].toFixed(3)}) is not on the paper`);
}

/** Pairs of faces whose model polygons overlap with positive area. */
export function overlapMatrix(s: PaperState): boolean[][] {
  const polys = s.cp.faces.map((_, f) => modelPolygon(s, f));
  const n = polys.length;
  const m = polys.map(() => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const o = convexIntersectionArea(polys[i], polys[j]) > AREA_TOL;
      m[i][j] = o;
      m[j][i] = o;
    }
  return m;
}

/**
 * Compact layer heights: a face sits one level above the highest overlapping face below it.
 * Faces that do not overlap share a level, so a flat sheet with creases stays flat.
 */
export function computeHeights(s: PaperState, overlaps = overlapMatrix(s)): number[] {
  const h = new Array<number>(s.cp.faces.length).fill(0);
  s.order.forEach((f, i) => {
    let best = 0;
    for (let j = 0; j < i; j++) if (overlaps[f][s.order[j]]) best = Math.max(best, h[s.order[j]] + 1);
    h[f] = best;
  });
  return h;
}
