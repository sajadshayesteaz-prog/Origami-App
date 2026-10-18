// Write one crease-pattern SVG per frame of a multi-frame FOLD file: <outDir>/001.svg, 002.svg, …
// Usage: node tools/fold-frames-to-svg.mjs <file.fold> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [file, outDir] = process.argv.slice(2);
if (!file || !outDir) {
  console.error("Usage: node tools/fold-frames-to-svg.mjs <file.fold> <outDir>");
  process.exit(1);
}
const COLORS = { B: "#111", M: "crimson", V: "royalblue", F: "#bbb", C: "limegreen", J: "gold", U: "orchid" };
const DASH = { M: "8 3 2 3", V: "8 4" };

const fold = JSON.parse(readFileSync(file, "utf8"));
const frames = fold.file_frames?.length ? fold.file_frames : [fold];
mkdirSync(outDir, { recursive: true });
frames.forEach((frame, i) => {
  const vs = frame.vertices_coords;
  const xs = vs.map((v) => v[0]);
  const ys = vs.map((v) => v[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const pad = span * 0.02;
  // Draw flat creases first so mountain/valley lines sit on top.
  const order = (a) => (a === "F" ? 0 : a === "B" ? 2 : 1);
  const edges = frame.edges_vertices
    .map((e, j) => ({ e, a: frame.edges_assignment?.[j] ?? "U" }))
    .sort((p, q) => order(p.a) - order(q.a));
  const lines = edges.map(({ e: [a, b], a: asg }) => {
    const dash = DASH[asg] ? ` stroke-dasharray="${DASH[asg]}"` : "";
    const width = asg === "B" ? 2 : 1.5;
    return `<line x1="${vs[a][0]}" y1="${vs[a][1]}" x2="${vs[b][0]}" y2="${vs[b][1]}" stroke="${COLORS[asg] ?? "#000"}" stroke-width="${width}" vector-effect="non-scaling-stroke"${dash}/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${span + 2 * pad} ${span + 2 * pad}" width="600" height="600">\n${lines.join("\n")}\n</svg>\n`;
  writeFileSync(join(outDir, `${String(i + 1).padStart(3, "0")}.svg`), svg);
});
console.log(`Wrote ${frames.length} SVGs to ${outDir}`);
