# Origami-App

Personal origami app (English UI): turns book diagrams into step-by-step 2D diagrams and 3D folding, driven by our own folding engine.

Planning, task sheets and reports live in the companion repo **Claude-Code-for-origami**, cloned next to this one. See `CLAUDE.md`.

## Setup
1. Both repos sit side by side in `D:\literature\کتاب\Origami\`.
2. Copy `.env.example` to `.env` and adjust paths.
3. Install Node.js 20+ (on the owner's PC: portable Node 22 in `%LOCALAPPDATA%\Programs\nodejs`).
4. Open Claude Code in this folder and ask it to run the current task sheet.

## Run the app
Double-click `run-dev.bat` (puts the portable Node in `%LOCALAPPDATA%\Programs\nodejs` on PATH, installs if needed, opens the browser), or:
```
npm install
npm run dev
```
Then open http://localhost:5173 and pick a model package to step through it (book image | diagram | 3D).

## Layout
| Path | What |
|---|---|
| `packages/engine/` | Folding engine (pure TypeScript, no UI): paper state, action language, interpreter, motion planner, 2D diagrams. Tests in `packages/engine/test/` |
| `app/` | Vite + React + TypeScript player (`app/src/player/`) |
| `app/public/samples/` | Reference FOLD/SVG files from the comms repo, used by tests (`npm run sync:samples`) |
| `app/public/origami-simulator/` | Trimmed Origami Simulator, kept but not used by the player (`npm run sync:simulator`) |
| `data/schema/` | JSON Schemas: `model-package.schema.json` (Model Package), `progress.schema.json` |
| `data/library/<id>/` | Model Packages: `model.json` (steps + actions), `images/` (book crops), `states.fold` (generated) |
| `tools/` | Scripts (Node now, Python pipelines later) |
| `vendor/` | Upstream sources (git-ignored): `bash ../Claude-Code-for-origami/sources/fetch-sources.sh vendor` |

## Scripts
| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check and production build to `dist/` |
| `npm test` | Engine unit tests (Vitest) |
| `npm run validate:data` | Validate every Model Package (schema, engine runs every step, `states.fold` up to date) |
| `npm run build:states` | Regenerate `data/library/*/states.fold` from `model.json` |
| `npm run sync:samples` | Re-copy samples from the comms repo |
| `npm run sync:simulator` | Re-copy Origami Simulator from `vendor/` and patch it for embedding |
| `node tools/fold-frames-to-svg.mjs <file.fold> <outDir>` | One crease-pattern SVG per frame |

The action language is specified in `Claude-Code-for-origami/docs/action-language.md`.
