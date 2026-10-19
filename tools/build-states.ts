// Regenerate data/library/<id>/states.fold from model.json (core-design §3.2).
// Usage: npm run build:states
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPackage, statesFold } from "../packages/engine/src";
import { listPackages } from "./packages";

let failed = false;
for (const { id, dir, model } of listPackages()) {
  const run = runPackage(model);
  const errors = run.steps.filter((s) => s.error).map((s) => s.error);
  if (errors.length) {
    failed = true;
    console.log(`FAIL ${id}: ${errors[0]}`);
    continue;
  }
  writeFileSync(join(dir, "states.fold"), JSON.stringify(statesFold(model, run)) + "\n");
  console.log(`ok   ${id}: ${run.steps.length} frames`);
}
process.exit(failed ? 1 : 0);
