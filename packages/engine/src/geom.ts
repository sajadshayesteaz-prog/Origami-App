/** 2D geometry helpers. The paper is the unit square, so absolute tolerances are fine. */

export type Vec2 = [number, number];

/** Distance below which two points or a point and a line count as coincident. */
export const TOL = 1e-7;
/** Area below which an overlap counts as touching only. */
export const AREA_TOL = 1e-9;

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  if (l < 1e-15) throw new Error("zero-length vector");
  return [a[0] / l, a[1] / l];
}

/** An infinite line: a point and a unit direction. */
export interface Line {
  p: Vec2;
  d: Vec2;
}

export function lineThrough(a: Vec2, b: Vec2): Line {
  if (dist(a, b) < TOL) throw new Error("a line needs two distinct points");
  return { p: a, d: normalize(sub(b, a)) };
}

/** Positive on the left of the line's direction. */
export const signedDist = (l: Line, p: Vec2) => cross(l.d, sub(p, l.p));

export function reflectPoint(l: Line, p: Vec2): Vec2 {
  const s = signedDist(l, p);
  const n = perp(l.d);
  return sub(p, scale(n, 2 * s));
}

export function projectOnLine(l: Line, p: Vec2): Vec2 {
  return add(l.p, scale(l.d, dot(sub(p, l.p), l.d)));
}

export function intersectLines(a: Line, b: Line): Vec2 | null {
  const den = cross(a.d, b.d);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(b.p, a.p), b.d) / den;
  return add(a.p, scale(a.d, t));
}

export const parallel = (a: Line, b: Line) => Math.abs(cross(a.d, b.d)) < 1e-12;

export function sameLine(a: Line, b: Line) {
  return parallel(a, b) && Math.abs(signedDist(a, b.p)) < TOL;
}

/** Perpendicular bisector of a and b, i.e. the fold line that brings a onto b (axiom 2). */
export function perpendicularBisector(a: Vec2, b: Vec2): Line {
  return { p: lerp2(a, b, 0.5), d: perp(normalize(sub(b, a))) };
}

/** Signed area, positive for counter-clockwise polygons (y up). */
export function polygonArea(poly: Vec2[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = cross(p, q);
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-15) return poly.reduce((s, p) => add(s, scale(p, 1 / poly.length)), [0, 0] as Vec2);
  return [cx / (3 * a), cy / (3 * a)];
}

/** Keeps the part of a convex polygon where side * signedDist >= 0. */
export function clipHalfPlane(poly: Vec2[], l: Line, side: 1 | -1): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = side * signedDist(l, p);
    const dq = side * signedDist(l, q);
    if (dp >= 0) out.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) out.push(lerp2(p, q, dp / (dp - dq)));
  }
  return dedupe(out);
}

/** Drops consecutive (and wrap-around) duplicate points. */
export function dedupe(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) if (!out.length || dist(out[out.length - 1], p) > 1e-12) out.push(p);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-12) out.pop();
  return out;
}

/** Area of the intersection of two convex polygons (any winding). */
export function convexIntersectionArea(a: Vec2[], b: Vec2[]) {
  const ccw = polygonArea(b) > 0;
  let poly = a;
  b = dedupe(b);
  for (let i = 0; i < b.length && poly.length; i++) {
    if (dist(b[i], b[(i + 1) % b.length]) <= 1e-12) continue;
    const l = lineThrough(b[i], b[(i + 1) % b.length]);
    poly = clipHalfPlane(poly, l, ccw ? 1 : -1);
  }
  return poly.length < 3 ? 0 : Math.abs(polygonArea(poly));
}

export const convexOverlap = (a: Vec2[], b: Vec2[]) => convexIntersectionArea(a, b) > AREA_TOL;

/** True when p is inside the convex polygon or on its boundary (within tol). */
export function pointInConvex(poly: Vec2[], p: Vec2, tol = TOL) {
  const ccw = polygonArea(poly) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const l = len(sub(b, a));
    if (l < 1e-15) continue;
    if ((ccw * cross(sub(b, a), sub(p, a))) / l < -tol) return false;
  }
  return true;
}

/** Parameter interval [t0, t1] (along l.d from l.p) where the line crosses a convex polygon, or null. */
export function lineConvexInterval(l: Line, poly: Vec2[]): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const ccw = polygonArea(poly) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const n: Vec2 = scale(perp(sub(b, a)), ccw); // inward normal
    const num = dot(n, sub(l.p, a));
    const den = dot(n, l.d);
    if (Math.abs(den) < 1e-15) {
      if (num < -1e-12) return null;
      continue;
    }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t1 - t0 > TOL ? [t0, t1] : null;
}
