# Origami-App

Personal bilingual (fa/en) origami app: basic folds guide, model library with step-by-step diagrams and 3D, and design tools.

Planning, task sheets and reports live in the companion repo **Claude-Code-for-origami**, cloned next to this one. See `CLAUDE.md`.

## Setup
1. Both repos sit side by side in `D:\literature\کتاب\Origami\`.
2. Copy `.env.example` to `.env` and adjust paths.
3. Install Node.js 20+ (on the owner's PC: portable Node 22 in `%LOCALAPPDATA%\Programs\nodejs`).
4. Open Claude Code in this folder and ask it to run the current task sheet.

## Run the app
```
npm install
npm run dev
```
Then open http://localhost:5173. The viewer loads `crane-sequence.fold` by default; pick another sample or open a `.fold` / `.svg` file.

## Layout
| Path | What |
|---|---|
| `app/` | Vite + React + TypeScript web app (`app/src/`), static files in `app/public/` |
| `app/public/samples/` | Sample FOLD/SVG files copied from the comms repo (`npm run sync:samples`) |
| `app/public/origami-simulator/` | Trimmed Origami Simulator used for the 3D view (`npm run sync:simulator`, needs `vendor/`) |
| `data/schema/` | JSON Schemas: Model, Step, Progress |
| `data/library/<id>/` | Library models: `model.json`, `steps/NNN.svg|png`, optional FOLD file |
| `tools/` | Scripts (Node now, Python pipelines later) |
| `vendor/` | Upstream sources (git-ignored): `bash ../Claude-Code-for-origami/sources/fetch-sources.sh vendor` |

## Scripts
| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run validate:data` | Validate `data/library/*/model.json` and example progress files |
| `npm run sync:samples` | Re-copy samples from the comms repo |
| `npm run sync:simulator` | Re-copy Origami Simulator from `vendor/` and patch it for embedding |
| `node tools/fold-frames-to-svg.mjs <file.fold> <outDir>` | One crease-pattern SVG per frame |
