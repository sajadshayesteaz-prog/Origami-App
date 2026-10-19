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
          const r = applyAction(state, action);
          motions.push(r.motion);
          marks.push(r.mark);
          warnings.push(...r.warnings);
          state = r.after;
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
