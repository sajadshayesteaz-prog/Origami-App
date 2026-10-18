import ear from "rabbit-ear";

/** A FOLD object (one frame, already flattened). Kept loose: FOLD has many optional fields. */
export type Fold = Record<string, any> & {
  vertices_coords?: number[][];
  edges_vertices?: number[][];
  edges_assignment?: string[];
  edges_foldAngle?: (number | null)[];
  faces_vertices?: number[][];
};

/** A loaded document: one or more frames to step through. */
export interface FoldDoc {
  name: string;
  title: string;
  frames: Fold[];
  /** What to send to the 3D simulator: FOLD frames, or the original Origami Simulator–style SVG. */
  source: { kind: "fold" } | { kind: "svg"; svg: string };
}

const ASSIGNMENT_ANGLE: Record<string, number> = { M: -180, m: -180, V: 180, v: 180 };

/** Origami Simulator's importFold message needs edges_foldAngle; derive it from assignments if absent. */
export function withFoldAngles(frame: Fold): Fold {
  if (frame.edges_foldAngle || !frame.edges_assignment) return frame;
  return { ...frame, edges_foldAngle: frame.edges_assignment.map((a) => ASSIGNMENT_ANGLE[a] ?? 0) };
}

function framesOf(fold: Fold): Fold[] {
  const count = ear.graph.getFileFramesAsArray(fold).length;
  const frames: Fold[] = [];
  for (let i = 0; i < count; i++) {
    const frame = ear.graph.flattenFrame(fold, i) as Fold;
    delete frame.file_frames;
    // A file with file_frames often has no geometry at the top level (e.g. crane-sequence.fold).
    if (frame.vertices_coords?.length) frames.push(frame);
  }
  return frames;
}

export function parseFoldDoc(name: string, text: string): FoldDoc {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "svg") {
    const fold = ear.convert.svgToFold(text, {}) as Fold;
    return { name, title: name, frames: [fold], source: { kind: "svg", svg: text } };
  }
  if (ext === "fold" || ext === "json") {
    const fold = JSON.parse(text) as Fold;
    const frames = framesOf(fold);
    if (!frames.length) throw new Error("FOLD file has no geometry");
    return { name, title: fold.file_title || name, frames, source: { kind: "fold" } };
  }
  throw new Error(`Unsupported file type: .${ext}`);
}
