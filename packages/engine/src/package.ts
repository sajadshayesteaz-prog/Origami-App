import { applyAction, type Action, type Mark } from "./actions";
import { renderDiagram } from "./diagram";
import { ActionError } from "./errors";
import { applyPoint } from "./mat";
import { stillMotion, type Motion } from "./motion";
import { initialState, overlapMatrix, faceUp, type PaperState } from "./state";

/** Model Package `model.json` (core-design §3; schema in data/schema/model-package.schema.json). */
export interface ModelPackage {
  format: "origami-model-package/1";
  id: string;
  title: string;
  designer?: string;
  source?: { book?: string; pages?: number[]; note?: string };
  difficulty?: { scale: string; value: number };
  paper: { shape: "square"; size?: string; colorUp?: string; colorDown?: string };
  category?: string;
  /** Other images of the model from the book (crease pattern, photo). */
  extras?: { kind: "cp" | "photo" | "other"; file: string; page?: number; bbox?: [number, number, number, number] }[];
  notes?: string;
  steps: Step[];
}

export interface Step {
  id: string;
  label: string;
  image?: { file: string; page?: number; bbox?: [number, number, number, number] };
  caption?: { original: string; lang?: string };
  level: "L0" | "L1" | "L2";
  actions?: Action[];
  notes?: string;
}

export interface StepResult {
  step: Step;
  before: PaperState;
  after: PaperState;
  /** One motion per action, played one after another. Empty for L0 steps. */
  motions: Motion[];
  marks: Mark[];
  /** 2D diagram (SVG) of the state before the step with the step's marks. */
  diagram: string;
  warnings: string[];
  /** Set when an action failed; later steps are not run. */
  error?: string;
}

export interface RunResult {
  steps: StepResult[];
  final: PaperState;
  /** Diagram of the finished state. */
  finalDiagram: string;
}

export function runPackage(pkg: ModelPackage): RunResult {
  const colors = { colorUp: pkg.paper.colorUp ?? "#ffffff", colorDown: pkg.paper.colorDown ?? "#f2a7b8" };
  let state = initialState();
  let failed: string | null = null;
  const steps: StepResult[] = [];
  for (const step of pkg.steps) {
    const before = state;
    const motions: Motion[] = [];
    const marks: Mark[] = [];
    const warnings: string[] = [];
    let error: string | undefined;
    if (failed) error = `not run: an earlier step failed (${failed})`;
    else if (step.level !== "L0") {
      for (const [i, action] of (step.actions ?? []).entries()) {
        try {
          for (const atom of expand(action, pkg)) {
            const r = applyAction(state, atom.action);
            motions.push(r.motion);
            if (!atom.quiet) marks.push(r.mark);
            warnings.push(...r.warnings);
            state = r.after;
          }
          if (action.op === "repeat") marks.push({ kind: "repeat", label: `repeat steps ${action.steps[0].replace(/^s/, "")}–${action.steps[1].replace(/^s/, "")}${action.side === "behind" ? " behind" : ""}` });
        } catch (e) {
          const msg = e instanceof ActionError ? e.message : `internal error: ${(e as Error).message}`;
          error = `step ${step.label}, action ${i + 1} (${action.op}): ${msg}`;
          failed = `step ${step.label}`;
          break;
        }
      }
    }
    if (!motions.length) motions.push(stillMotion(state));
    steps.push({ step, before, after: state, motions, marks, diagram: renderDiagram(before, marks, colors), warnings, error });
  }
  return { steps, final: state, finalDiagram: renderDiagram(state, [], colors) };
}

/**
 * Macros → atomic/compound actions. `group` runs its actions in order. `repeat` re-runs the
 * actions of a step range; with side "behind" the model is turned over first and back after.
 * `map` renames point names in the repeated actions (e.g. {"B": "D"}); names created with `as`
 * get a "'" suffix so they do not clash with the originals.
 */
function expand(action: Action, pkg: ModelPackage, depth = 0): { action: Action; quiet?: boolean }[] {
  if (depth > 4) throw new ActionError("repeat/group nested too deeply");
  if (action.op === "group") return action.actions.flatMap((a) => expand(a, pkg, depth + 1));
  if (action.op !== "repeat") return [{ action }];
  const ids = pkg.steps.map((s) => s.id);
  const [i0, i1] = action.steps.map((id) => ids.indexOf(id));
  if (i0 < 0 || i1 < 0 || i1 < i0) throw new ActionError(`repeat: unknown step range ${action.steps.join("–")}`);
  const map = action.map ?? {};
  const source = pkg.steps.slice(i0, i1 + 1).flatMap((s) => (s.actions ?? []).filter((a) => a.op !== "repeat"));
  // Names created inside the repeated range get a "'" suffix; earlier names are kept.
  const defined = new Set<string>();
  const collect = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(collect);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) k === "as" ? defined.add(v as string) : collect(v);
  };
  collect(source);
  const named = (v: string) => (defined.has(v) ? `${v}'` : (map[v] ?? v));
  const rename = (x: unknown): unknown => {
    if (typeof x === "string") return named(x);
    if (Array.isArray(x)) return x.map(rename);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x))
        o[k] = k === "as" ? `${v}'` : k === "name" ? named(v as string) : ["op", "type", "assign", "axis", "side", "text"].includes(k) ? v : rename(v);
      return o;
    }
    return x;
  };
  const body = source.map((a) => ({ action: rename(a) as Action }));
  if (action.side !== "behind") return body.flatMap((b) => expand(b.action, pkg, depth + 1));
  const turn: Action = { op: "turnOver", axis: action.axis ?? "vertical" };
  return [{ action: turn, quiet: true }, ...body.flatMap((b) => expand(b.action, pkg, depth + 1)), { action: turn, quiet: true }];
}

/** Layer order as FOLD faceOrders: [f, g, s] = face f lies on side s of face g (along g's normal). */
export function faceOrders(s: PaperState): [number, number, number][] {
  const ov = overlapMatrix(s);
  const out: [number, number, number][] = [];
  const pos = s.order.map((_, i) => i);
  s.order.forEach((f, i) => (pos[f] = i));
  for (let a = 0; a < s.cp.faces.length; a++)
    for (let b = a + 1; b < s.cp.faces.length; b++) if (ov[a][b]) out.push([a, b, (pos[a] > pos[b] ? 1 : -1) * faceUp(s, b)]);
  return out;
}

/** One FOLD frame for a state: crease pattern, fold angles, folded coordinates and layer order. */
export function stateToFold(s: PaperState, title: string): Record<string, unknown> {
  const folded = s.cp.vertices.map((v, i) => {
    const f = s.cp.faces.findIndex((loop) => loop.includes(i));
    const p = applyPoint(s.faceM[f], [v[0], v[1], 0]);
    return [round(p[0]), round(p[1])];
  });
  return {
    frame_title: title,
    frame_classes: ["creasePattern"],
    vertices_coords: s.cp.vertices.map((v) => [round(v[0]), round(v[1])]),
    edges_vertices: s.cp.edges.map((e) => e.v),
    edges_assignment: s.cp.edges.map((e) => e.a),
    edges_foldAngle: s.cp.edges.map((e) => (e.a === "V" ? 180 : e.a === "M" ? -180 : 0)),
    faces_vertices: s.cp.faces,
    faceOrders: faceOrders(s),
    "origami:vertices_foldedCoords": folded,
  };
}

const round = (x: number) => Math.round(x * 1e10) / 1e10;

/** states.fold: one frame per step after its actions (core-design §3.2). */
export function statesFold(pkg: ModelPackage, run: RunResult): Record<string, unknown> {
  return {
    file_spec: 1.2,
    file_creator: "Origami-App engine",
    file_title: pkg.title,
    file_classes: ["diagrams"],
    file_frames: run.steps.map((r) => stateToFold(r.after, `${r.step.label}`)),
  };
}
