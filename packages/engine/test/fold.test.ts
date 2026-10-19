import ear from "rabbit-ear";
import { describe, expect, it } from "vitest";
import { applyAction, type Action } from "../src/actions";
import { splitFace, edgeFaces } from "../src/cp";
import { ActionError } from "../src/errors";
import { polygonArea } from "../src/geom";
import { applyPoint } from "../src/mat";
import { faceOrders } from "../src/package";
import { faceUp, initialState, modelPolygon, type PaperState } from "../src/state";

const run = (actions: Action[], s: PaperState = initialState()) => actions.reduce((st, a) => applyAction(st, a).after, s);
const mid = (a: string, b: string) => ({ mid: [a, b] as [string, string] });

/** Asks Rabbit Ear's layer solver whether our state's layer order is a valid one. */
function solverAccepts(s: PaperState) {
  const coords = s.cp.vertices.map((v, i) => {
    const f = s.cp.faces.findIndex((l) => l.includes(i));
    const p = applyPoint(s.faceM[f], [v[0], v[1], 0]);
    return [p[0], p[1]];
  });
  const graph = {
    vertices_coords: coords,
    edges_vertices: s.cp.edges.map((e) => e.v),
    edges_assignment: s.cp.edges.map((e) => e.a),
    faces_vertices: s.cp.faces,
    faceOrders: faceOrders(s),
  };
  ear.layer(graph).faceOrders(); // throws if our orders conflict with any valid state
  return true;
}

describe("crease pattern", () => {
  it("splits the square along a diagonal into two triangles", () => {
    const s = initialState();
    const r = splitFace(s.cp, 0, { p: [0, 0], d: [Math.SQRT1_2, Math.SQRT1_2] }, "V")!;
    expect(s.cp.faces).toHaveLength(2);
    expect(s.cp.faces.map((f) => f.length)).toEqual([3, 3]);
    for (const f of [r.left, r.right]) expect(Math.abs(polygonArea(s.cp.faces[f].map((v) => s.cp.vertices[v])))).toBeCloseTo(0.5, 12);
    expect(s.cp.edges[r.edge].a).toBe("V");
    expect(edgeFaces(s.cp)[r.edge]).toHaveLength(2);
  });

  it("splitting a face also splits the neighbour's shared edge", () => {
    const s = run([{ op: "foldUnfold", line: { through: ["A", "C"] } }, { op: "foldUnfold", line: { through: [mid("A", "B"), mid("D", "C")] } }]);
    // The vertical midline crosses both triangles: 4 faces, all edges shared consistently.
    expect(s.cp.faces).toHaveLength(4);
    const ef = edgeFaces(s.cp);
    s.cp.edges.forEach((e, i) => expect(ef[i].length).toBe(e.a === "B" ? 1 : 2));
  });
});

describe("valley and mountain", () => {
  it("valley: the moving half lands on top, flipped, with a V crease", () => {
    const r = applyAction(initialState(), { op: "valley", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" });
    const s = r.after;
    const top = s.order[s.order.length - 1];
    expect(faceUp(s, top)).toBe(-1);
    expect(s.cp.edges.filter((e) => e.a === "V")).toHaveLength(1);
    expect(solverAccepts(s)).toBe(true);
  });

  it("mountain: the moving half goes behind, with an M crease", () => {
    const s = run([{ op: "mountain", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" }]);
    expect(faceUp(s, s.order[0])).toBe(-1);
    expect(s.cp.edges.filter((e) => e.a === "M")).toHaveLength(1);
    expect(solverAccepts(s)).toBe(true);
  });

  it("layer order after a sequence of folds stays valid", () => {
    const s = run([
      { op: "valley", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" },
      // After folding in half, the midpoints of AB and DC coincide: use O for the vertical line.
      { op: "valley", line: { through: ["O", mid("D", "C")] }, move: "C" },
      { op: "mountain", line: { through: ["O", "D"] }, move: mid("D", "C") },
    ]);
    expect(s.cp.faces.length).toBeGreaterThanOrEqual(8);
    expect(solverAccepts(s)).toBe(true);
    // Four layers everywhere: heights 0..3 on overlapping faces.
    expect(Math.max(...s.heights)).toBeGreaterThanOrEqual(3);
  });

  it("turned over: a valley as seen becomes a mountain on the paper", () => {
    const s = run([{ op: "turnOver" }, { op: "valley", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" }]);
    expect(s.cp.edges.filter((e) => e.a === "M")).toHaveLength(1);
  });
});

describe("moving-set closure", () => {
  // Fold in half (2 layers), then fold the top layer's corner: the layer below is attached
  // along the first fold, so folding through it must pull it in.
  const half: Action = { op: "valley", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" };

  it("pulls in an attached layer and reports it", () => {
    const s = run([half]);
    const r = applyAction(s, { op: "valley", line: { through: [mid("D", "C"), "O"] }, move: "D", layers: { top: 1 } });
    expect(r.warnings.join(" ")).toMatch(/pulled in an unselected layer/);
    // Both layers moved: the right part now has 2 layers stacked on the left part's 2.
    expect(Math.max(...r.after.heights)).toBe(3);
  });

  it("selecting only the top layer of an open flap moves that layer alone", () => {
    const s = run([half]);
    // A line parallel to the hinge (top edge in view) through the middle: top layer is free there.
    const r = applyAction(s, { op: "valley", line: { through: [{ at: ["D", "A", 0.25] }, { at: ["C", "B", 0.25] }] }, move: "D", layers: { top: 1 } });
    expect(r.warnings).toHaveLength(0);
    expect(r.after.cp.faces.length).toBe(3);
  });
});

describe("impossible actions are rejected with readable errors", () => {
  const expectError = (actions: Action[], re: RegExp) => {
    expect(() => run(actions)).toThrow(ActionError);
    expect(() => run(actions)).toThrow(re);
  };

  it("fold line outside the paper", () => {
    expectError([{ op: "valley", line: { through: [{ cp: [0, 0] }, { cp: [1, 0] }] } }], /does not cross/);
  });

  it("fold blocked by a layer above the moving flap", () => {
    // Fold in half, then fold only the bottom layer upward (valley): the top layer is in the way.
    expectError(
      [
        { op: "valley", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" },
        { op: "valley", line: { through: [{ at: ["D", "A", 0.25] }, { at: ["C", "B", 0.25] }] }, move: "D", layers: { bottom: 1 } },
      ],
      /blocked/,
    );
  });

  it("collapse along creases that cannot fold flat", () => {
    expectError(
      [
        { op: "foldUnfold", line: { through: ["A", "C"] } },
        { op: "foldUnfold", line: { through: ["B", "D"] } },
        { op: "collapse", creases: [{ line: { through: ["A", "C"] }, type: "V" }, { line: { through: ["B", "D"] }, type: "V" }] },
      ],
      /not flat-foldable|no valid layer order/,
    );
  });

  it("unfold where there is no fold", () => {
    expectError([{ op: "unfold", line: { through: ["A", "C"] } }], /no existing fold/);
  });

  it("unknown point name", () => {
    expectError([{ op: "valley", line: { through: [{ name: "nowhere" }, "A"] } }], /unknown point name/);
  });
});

describe("unfold", () => {
  it("returns a folded flap to the flat sheet", () => {
    const s = run([
      { op: "valley", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" },
      { op: "unfold", line: { through: [mid("A", "D"), mid("B", "C")] }, move: "A" },
    ]);
    expect(s.cp.faces.every((_, f) => faceUp(s, f) === 1)).toBe(true);
    expect(s.cp.edges.filter((e) => e.a !== "B").map((e) => e.a)).toEqual(["F"]);
    const area = s.cp.faces.reduce((a, _, f) => a + Math.abs(polygonArea(modelPolygon(s, f))), 0);
    expect(area).toBeCloseTo(1, 9);
  });
});
