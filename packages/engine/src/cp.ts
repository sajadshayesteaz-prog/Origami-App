import { dist, lerp2, signedDist, TOL, type Line, type Vec2 } from "./geom";

/** FOLD edge assignments: Boundary, Mountain, Valley, Flat (unfolded crease), Unassigned. */
export type Assignment = "B" | "M" | "V" | "F" | "U";

export interface Edge {
  v: [number, number];
  a: Assignment;
}

/**
 * Crease pattern: a planar graph on the unfolded paper (y up).
 * Faces are convex vertex loops, counter-clockwise, so each face's front is CP +z.
 */
export interface CP {
  vertices: Vec2[];
  edges: Edge[];
  faces: number[][];
}

export const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export function cloneCP(cp: CP): CP {
  return {
    vertices: cp.vertices.map((v) => [v[0], v[1]] as Vec2),
    edges: cp.edges.map((e) => ({ v: [e.v[0], e.v[1]], a: e.a })),
    faces: cp.faces.map((f) => f.slice()),
  };
}

export function edgeMap(cp: CP) {
  const m = new Map<string, number>();
  cp.edges.forEach((e, i) => m.set(edgeKey(e.v[0], e.v[1]), i));
  return m;
}

export function findEdge(cp: CP, a: number, b: number) {
  return cp.edges.findIndex((e) => (e.v[0] === a && e.v[1] === b) || (e.v[0] === b && e.v[1] === a));
}

/** The vertex at p, adding one if none is within tolerance. */
export function findOrAddVertex(cp: CP, p: Vec2): number {
  const i = cp.vertices.findIndex((v) => dist(v, p) < TOL);
  if (i !== -1) return i;
  cp.vertices.push([p[0], p[1]]);
  return cp.vertices.length - 1;
}

/** Splits edge (a,b) at vertex v; every face loop that walks a→b or b→a gets v inserted. */
export function splitEdge(cp: CP, edgeIndex: number, v: number) {
  const e = cp.edges[edgeIndex];
  const [a, b] = e.v;
  if (v === a || v === b) return;
  cp.edges[edgeIndex] = { v: [a, v], a: e.a };
  cp.edges.push({ v: [v, b], a: e.a });
  for (const loop of cp.faces) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      if ((p === a && q === b) || (p === b && q === a)) {
        loop.splice(i + 1, 0, v);
        break;
      }
    }
  }
}

/**
 * Splits face f by a line given in CP coordinates. The face keeps index f for the part on the
 * line's left (signedDist > 0); the right part becomes a new face. The new edge gets `assign`,
 * or keeps its assignment if it already exists. Returns null if the line misses the interior.
 */
export function splitFace(cp: CP, f: number, line: Line, assign: Assignment): { left: number; right: number; edge: number } | null {
  let loop = cp.faces[f];
  const d = loop.map((v) => signedDist(line, cp.vertices[v]));
  if (!d.some((x) => x > TOL) || !d.some((x) => x < -TOL)) return null;
  // Insert vertices where the line crosses an edge strictly between its ends.
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    const dp = signedDist(line, cp.vertices[p]);
    const dq = signedDist(line, cp.vertices[q]);
    if ((dp > TOL && dq < -TOL) || (dp < -TOL && dq > TOL)) {
      const x = lerp2(cp.vertices[p], cp.vertices[q], dp / (dp - dq));
      const v = findOrAddVertex(cp, x);
      const ei = findEdge(cp, p, q);
      if (ei === -1) throw new Error(`internal: missing edge ${p}-${q}`);
      splitEdge(cp, ei, v);
      loop = cp.faces[f];
      i = -1; // restart: loop changed
    }
  }
  const on = loop.map((v, i) => [i, Math.abs(signedDist(line, cp.vertices[v])) <= TOL] as const).filter(([, o]) => o).map(([i]) => i);
  if (on.length !== 2) throw new Error(`internal: face ${f} crossed at ${on.length} vertices`);
  const [i, j] = on;
  const partA = loop.slice(i, j + 1);
  const partB = [...loop.slice(j), ...loop.slice(0, i + 1)];
  const sideOf = (part: number[]) => part.map((v) => signedDist(line, cp.vertices[v])).reduce((s, x) => s + x, 0);
  const [left, right] = sideOf(partA) > 0 ? [partA, partB] : [partB, partA];
  cp.faces[f] = left;
  cp.faces.push(right);
  const a = loop[i];
  const b = loop[j];
  let edge = findEdge(cp, a, b);
  if (edge === -1) {
    cp.edges.push({ v: [a, b], a: assign });
    edge = cp.edges.length - 1;
  }
  return { left: f, right: cp.faces.length - 1, edge };
}

/** Faces on each side of every edge (one entry for boundary edges). */
export function edgeFaces(cp: CP): number[][] {
  const m = edgeMap(cp);
  const out: number[][] = cp.edges.map(() => []);
  cp.faces.forEach((loop, f) => {
    for (let i = 0; i < loop.length; i++) {
      const e = m.get(edgeKey(loop[i], loop[(i + 1) % loop.length]));
      if (e !== undefined) out[e].push(f);
    }
  });
  return out;
}

export function facePolygon(cp: CP, f: number): Vec2[] {
  return cp.faces[f].map((v) => cp.vertices[v]);
}
