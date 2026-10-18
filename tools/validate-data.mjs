// Validate every data/library/*/model.json against data/schema/ and check referenced files exist.
// Also validates data/schema/examples/*.progress.json against the Progress schema.
// Usage: npm run validate:data
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = join(root, "data", "schema");
const libraryDir = join(root, "data", "library");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
for (const f of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(readJson(join(schemaDir, f)));
}
const validateModel = ajv.getSchema("https://origami-app.local/schema/model.schema.json");
const validateProgress = ajv.getSchema("https://origami-app.local/schema/progress.schema.json");

let failures = 0;
const fail = (where, msg) => {
  failures++;
  console.log(`FAIL ${where}: ${msg}`);
};

for (const id of readdirSync(libraryDir)) {
  const file = join(libraryDir, id, "model.json");
  if (!existsSync(file)) continue;
  const where = `data/library/${id}/model.json`;
  const model = readJson(file);
  if (!validateModel(model)) {
    for (const e of validateModel.errors) fail(where, `${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  // Checks JSON Schema cannot express.
  if (model.id !== id) fail(where, `id "${model.id}" does not match folder "${id}"`);
  if (model.stepCount !== model.steps.length) fail(where, `stepCount ${model.stepCount} != steps.length ${model.steps.length}`);
  model.steps.forEach((s, i) => {
    if (s.index !== i + 1) fail(where, `steps[${i}].index is ${s.index}, expected ${i + 1}`);
    if (!existsSync(join(libraryDir, id, s.image))) fail(where, `missing ${s.image}`);
  });
  if (model.has3D) {
    const foldPath = join(libraryDir, id, model.fold3D);
    if (!existsSync(foldPath)) fail(where, `missing ${model.fold3D}`);
    else {
      const frames = readJson(foldPath).file_frames?.length ?? 1;
      for (const s of model.steps) {
        if (s.foldFrame !== undefined && s.foldFrame >= frames) fail(where, `step ${s.index} foldFrame ${s.foldFrame} >= ${frames} frames`);
      }
    }
  }
  console.log(`ok   ${where} (${model.steps.length} steps)`);
}

const examplesDir = join(schemaDir, "examples");
if (existsSync(examplesDir)) {
  for (const f of readdirSync(examplesDir).filter((f) => f.endsWith(".progress.json"))) {
    const where = `data/schema/examples/${f}`;
    if (validateProgress(readJson(join(examplesDir, f)))) console.log(`ok   ${where}`);
    else for (const e of validateProgress.errors) fail(where, `${e.instancePath || "/"} ${e.message}`);
  }
}

if (failures) {
  console.log(`${failures} problem(s)`);
  process.exit(1);
}
console.log("All data valid.");
