import {
  add,
  cross,
  dist,
  dot,
  intersectLines,
  lineThrough,
  normalize,
  parallel,
  perpendicularBisector,
  perp,
  reflectPoint,
  scale,
  signedDist,
  sub,
  TOL,
  type Line,
  type Vec2,
} from "./geom";

/** Huzita–Hatori axioms. Each returns every solution (possibly none), in a stable order. */

/** O1: the line through p and q. */
export const axiom1 = (p: Vec2, q: Vec2): Line[] => [lineThrough(p, q)];

/** O2: the fold that brings p onto q. */
export const axiom2 = (p: Vec2, q: Vec2): Line[] => (dist(p, q) < TOL ? [] : [perpendicularBisector(p, q)]);

/** O3: folds that bring line a onto line b (angle bisectors, or the midline if parallel). */
export function axiom3(a: Line, b: Line): Line[] {
  if (parallel(a, b)) {
    const s = signedDist(a, b.p);
    if (Math.abs(s) < TOL) return [];
    return [{ p: add(a.p, scale(perp(a.d), s / 2)), d: a.d }];
  }
  const x = intersectLines(a, b)!;
  const db = dot(a.d, b.d) < 0 ? scale(b.d, -1) : b.d;
  return [
    { p: x, d: normalize(add(a.d, db)) },
    { p: x, d: normalize(sub(a.d, db)) },
  ];
}

/** O4: the fold through p perpendicular to l. */
export const axiom4 = (p: Vec2, l: Line): Line[] => [{ p, d: perp(l.d) }];

/** O5: folds through q that bring p onto l. */
export function axiom5(p: Vec2, l: Line, q: Vec2): Line[] {
  const r = dist(p, q);
  const foot = add(l.p, scale(l.d, dot(sub(q, l.p), l.d)));
  const h = Math.abs(signedDist(l, q));
  if (h > r + TOL) return [];
  const half = Math.sqrt(Math.max(0, r * r - h * h));
  const images: Vec2[] = half < TOL ? [foot] : [sub(foot, scale(l.d, half)), add(foot, scale(l.d, half))];
  return images.filter((x) => dist(x, p) > TOL).map((x) => perpendicularBisector(p, x));
}

/** O6: folds that bring p1 onto l1 and p2 onto l2 at once (roots of a cubic). */
export function axiom6(p1: Vec2, l1: Line, p2: Vec2, l2: Line): Line[] {
  // Put p1's image on l1 at parameter s: x(s) = l1.p + s l1.d. The fold is the perpendicular
  // bisector of p1 and x(s). Requiring p2's reflection to lie on l2 gives f(s) = 0, where
  // f(s) = cross(l2.d, |n|^2 p2 - 2((p2 - m)·n) n - |n|^2 l2.p), n = x - p1, m = (p1 + x)/2,
  // a cubic polynomial in s. Fit it exactly from four samples, then solve.
  const f = (s: number) => {
    const x = add(l1.p, scale(l1.d, s));
    const n = sub(x, p1);
    const n2 = dot(n, n);
    const m = scale(add(p1, x), 0.5);
    const r = sub(sub(scale(p2, n2), scale(n, 2 * dot(sub(p2, m), n))), scale(l2.p, n2));
    return cross(l2.d, r);
  };
  const coeffs = fitCubic(f);
  const roots = solveCubic(coeffs);
  const lines: Line[] = [];
  for (const s of roots) {
    const x = add(l1.p, scale(l1.d, s));
    if (dist(x, p1) < TOL) continue;
    const line = perpendicularBisector(p1, x);
    const image2 = reflectPoint(line, p2);
    if (Math.abs(signedDist(l2, image2)) > 1e-6) continue;
    if (!lines.some((l) => Math.abs(cross(l.d, line.d)) < 1e-9 && Math.abs(signedDist(l, line.p)) < 1e-9)) lines.push(line);
  }
  return lines;
}

/** O7: the fold perpendicular to l2 that brings p onto l1. */
export function axiom7(p: Vec2, l1: Line, l2: Line): Line[] {
  const x = intersectLines({ p, d: l2.d }, l1);
  if (!x || dist(x, p) < TOL) return [];
  return [perpendicularBisector(p, x)];
}

/** Coefficients [a, b, c, d] of a*s^3 + b*s^2 + c*s + d through f at s = -1, 0, 1, 2. */
function fitCubic(f: (s: number) => number): [number, number, number, number] {
  const y0 = f(-1);
  const y1 = f(0);
  const y2 = f(1);
  const y3 = f(2);
  const d = y1;
  const a = (y3 - 3 * y2 + 3 * y1 - y0) / 6;
  const b = (y2 + y0 - 2 * y1) / 2;
  const c = (y2 - y0) / 2 - a;
  return [a, b, c, d];
}

/** Real roots of a cubic, degrading to quadratic/linear when leading terms vanish. */
export function solveCubic([a, b, c, d]: [number, number, number, number]): number[] {
  const scaleMax = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1e-300);
  if (Math.abs(a) / scaleMax < 1e-12) {
    if (Math.abs(b) / scaleMax < 1e-12) return Math.abs(c) / scaleMax < 1e-12 ? [] : [-d / c];
    const disc = c * c - 4 * b * d;
    if (disc < 0) return [];
    const r = Math.sqrt(disc);
    return [(-c - r) / (2 * b), (-c + r) / (2 * b)];
  }
  // Depressed cubic t^3 + pt + q with s = t - B/3.
  const B = b / a;
  const C = c / a;
  const D = d / a;
  const p = C - (B * B) / 3;
  const q = (2 * B * B * B) / 27 - (B * C) / 3 + D;
  const shift = -B / 3;
  const disc = (q * q) / 4 + (p * p * p) / 27;
  let roots: number[];
  if (disc > 1e-14) {
    const u = Math.cbrt(-q / 2 + Math.sqrt(disc));
    const v = Math.cbrt(-q / 2 - Math.sqrt(disc));
    roots = [u + v];
  } else if (Math.abs(p) < 1e-14) {
    roots = [Math.cbrt(-q)];
  } else {
    const r = 2 * Math.sqrt(-p / 3);
    const phi = Math.acos(Math.max(-1, Math.min(1, (3 * q) / (p * r))));
    roots = [0, 1, 2].map((k) => r * Math.cos(phi / 3 - (2 * Math.PI * k) / 3));
  }
  return roots.map((t) => t + shift).sort((x, y) => x - y);
}
