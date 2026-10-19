// Shared helpers for tools: list and load Model Packages from data/library/.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelPackage } from "../packages/engine/src";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const libraryDir = join(root, "data", "library");
export const schemaDir = join(root, "data", "schema");
export const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

export function listPackages(): { id: string; dir: string; model: ModelPackage }[] {
  return readdirSync(libraryDir)
    .filter((id) => existsSync(join(libraryDir, id, "model.json")))
    .map((id) => ({ id, dir: join(libraryDir, id), model: readJson(join(libraryDir, id, "model.json")) }));
}
