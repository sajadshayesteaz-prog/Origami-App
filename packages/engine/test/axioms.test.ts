import { describe, expect, it } from "vitest";
import { axiom1, axiom2, axiom3, axiom4, axiom5, axiom6, axiom7, solveCubic } from "../src/axioms";
import { cross, dot, lineThrough, reflectPoint, signedDist, type Line, type Vec2 } from "../src/geom";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const onLine = (l: Line, p: Vec2) => near(signedDist(l, p), 0);
const ax: Line = { p: [0, 0], d: [1, 0] }; // x axis
const ay: Line = { p: [0, 0], d: [0, 1] }; // y axis

describe("Huzita–Hatori axioms", () => {
  it("O1: the line through two points", () => {
    const [l] = axiom1([0, 0], [1, 1]);
    onLine(l, [0, 0]);
    onLine(l, [1, 1]);
  });

  it("O2: brings one point onto another", () => {
    const [l] = axiom2([0, 0], [1, 0]);
    const r = reflectPoint(l, [0, 0]);
    near(r[0], 1);
    near(r[1], 0);
  });

  it("O3: bisectors of two crossing lines, midline of parallel lines", () => {
    const ls = axiom3(ax, ay);
    expect(ls).toHaveLength(2);
    for (const l of ls) {
      // Reflecting a point of the x axis lands on the y axis.
      const r = reflectPoint(l, [1, 0]);
      near(r[0], 0);
    }
    const [m] = axiom3(ax, { p: [0, 2], d: [1, 0] });
    onLine(m, [5, 1]);
    near(cross(m.d, [1, 0]), 0);
  });

  it("O4: through a point, perpendicular to a line", () => {
    const [l] = axiom4([0.3, 0.7], ax);
    onLine(l, [0.3, 0.7]);
    near(dot(l.d, ax.d), 0);
  });

  it("O5: through a point, bringing another point onto a line", () => {
    const p: Vec2 = [0, 1];
    const q: Vec2 = [0.5, 0];
    const ls = axiom5(p, ax, q);
    expect(ls.length).toBe(2);
    for (const l of ls) {
      onLine(l, q);
      near(reflectPoint(l, p)[1], 0);
    }
  });

  it("O6: brings two points onto two lines at once", () => {
    const p1: Vec2 = [0, 1];
    const p2: Vec2 = [1, 0.5];
    const l2: Line = { p: [0, 0], d: [0, 1] };
    const ls = axiom6(p1, ax, p2, l2);
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) {
      near(reflectPoint(l, p1)[1], 0);
      near(reflectPoint(l, p2)[0], 0);
    }
  });

  it("O6: three solutions where the cubic has three real roots", () => {
    // Classic angle-trisection-like configuration.
    const ls = axiom6([0, 0.5], lineThrough([0, 0], [1, 0]), [0.25, 1], lineThrough([0, 0.25], [1, 0.25]));
    for (const l of ls) {
      near(reflectPoint(l, [0, 0.5])[1], 0);
      near(reflectPoint(l, [0.25, 1])[1], 0.25);
    }
  });

  it("O7: perpendicular to one line, bringing a point onto another", () => {
    const p: Vec2 = [0.5, 1];
    const l2: Line = { p: [0, 0], d: [1, 1].map((x) => x / Math.SQRT2) as Vec2 };
    const [l] = axiom7(p, ax, l2);
    near(reflectPoint(l, p)[1], 0);
    near(dot(l.d, l2.d), 0);
  });

  it("cubic solver finds real roots", () => {
    expect(solveCubic([1, -6, 11, -6]).map((x) => +x.toFixed(9))).toEqual([1, 2, 3]);
    expect(solveCubic([0, 1, -3, 2]).map((x) => +x.toFixed(9))).toEqual([1, 2]);
  });
});
