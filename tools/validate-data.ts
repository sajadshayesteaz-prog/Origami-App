// Validate every Model Package: schema, referenced images, and that the engine runs every
// scripted step. Also checks states.fold is up to date and validates example progress files.
// Usage: npm run validate:data
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPackage, statesFold } from "../packages/engine/src";
import { listPackages, readJson, schemaDir } from "./packages";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const f of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(readJson(join(schemaDir, f)));
const validatePackage = ajv.getSchema("https://origami-app.local/schema/model-package.schema.json")!;
const validateProgress = ajv.getSchema("https://origami-app.local/schema/progress.schema.json")!;

let failures = 0;
const fail = (where: string, msg: string) => {
  failures++;
  console.log(`FAIL ${where}: ${msg}`);
};

for (const { id, dir, model } of listPackages()) {
  const where = `data/library/${id}/model.json`;
  if (!validatePackage(model)) {
    for (const e of validatePackage.errors!) fail(where, `${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  if (model.id !== id) fail(where, `id "${model.id}" does not match folder "${id}"`);
  const ids = new Set<string>();
  for (const s of model.steps) {
    if (ids.has(s.id)) fail(where, `duplicate step id ${s.id}`);
    ids.add(s.id);
    if (s.image && !existsSync(join(dir, s.image.file))) fail(where, `missing ${s.image.file}`);
  }
  const run = runPackage(model);
  for (const s of run.steps) if (s.error) fail(where, s.error);
  const statesPath = join(dir, "states.fold");
  if (!existsSync(statesPath)) fail(where, "states.fold missing (run npm run build:states)");
  else if (readFileSync(statesPath, "utf8").trim() !== JSON.stringify(statesFold(model, run))) fail(where, "states.fold is out of date (run npm run build:states)");
  const levels = model.steps.reduce<Record<string, number>>((m, s) => ((m[s.level] = (m[s.level] ?? 0) + 1), m), {});
  console.log(`ok   ${where} (${model.steps.length} steps: ${Object.entries(levels).map(([k, v]) => `${v} ${k}`).join(", ")})`);
}

const examples = join(schemaDir, "examples");
for (const f of readdirSync(examples).filter((f) => f.endsWith(".progress.json"))) {
  const where = `data/schema/examples/${f}`;
  if (validateProgress(readJson(join(examples, f)))) console.log(`ok   ${where}`);
  else for (const e of validateProgress.errors!) fail(where, `${e.instancePath || "/"} ${e.message}`);
}

if (failures) {
  console.log(`${failures} problem(s)`);
  process.exit(1);
}
console.log("All data valid.");
