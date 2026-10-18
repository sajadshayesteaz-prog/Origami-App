# CLAUDE.md — Origami App

## What this project is
A personal (not published) cross-platform origami app, bilingual Persian/English (Persian is RTL), with three parts:
1. **Basic folds guide** — diagram symbols, basic folds and classic bases.
2. **Model library** — step-by-step folding of intermediate→advanced models, steps cut from book PDFs, with an optional synced 3D view.
3. **Design tools** — (a) image → tree base → crease pattern; (b) 3D model → crease pattern.

The owner communicates in Persian. Write code, comments and commit messages in English; write reports and STATUS in Persian.

## Two repositories
- **This repo (Origami-App):** all code and app data.
- **Communication repo (Claude-Code-for-origami):** task sheets, reports, status, decisions, project docs, technical sources. Location: `COMMS_DIR` from `.env`; default `../Claude-Code-for-origami`. Run `git pull` there before starting a task.

## Priorities right now
- Get a working app up quickly. **Do not spend time on licensing, citation formatting or source validation** — the owner has deferred these.
- Prefer reusing the open-source libraries below over writing algorithms from scratch.

## How work arrives and how you report
- Each task is `$COMMS_DIR/docs/tasks/NNN-name.md`. Do exactly that task; anything outside it goes under "Open questions".
- When done:
  1. Commit and push code here.
  2. Write `$COMMS_DIR/docs/reports/NNN-name.md` with sections: چه ساخته شد · چطور اجرا کنم (exact commands) · معیارهای پذیرش (each: pass/fail + evidence) · تصمیم‌های فنی · مشکلات و سؤال‌های باز · پیشنهاد کار بعدی. Include the Origami-App commit hash.
  3. Append one line per decision to `$COMMS_DIR/docs/decisions.md`; update `$COMMS_DIR/docs/STATUS.md`.
  4. Commit and push the comms repo.
- If a task is blocked on a decision only the owner can make, stop and ask rather than guessing.

## Reference material (in the comms repo — read before coding)
- `docs/handoff.md` — protocol and phase table. `docs/brief.md` — project brief. `docs/roadmap.md` — phases 0–7.
- `sources/00-index.md` — index of technical sources; read it first.
- `sources/digest-core-libraries.md` — FOLD, Rabbit Ear, Origami Simulator.
- `sources/digest-design-engines.md` — BP Studio, TreeMaker, ReferenceFinder, skeletonize.
- `sources/digest-editors-and-3d.md` — ORIPA, cp-editor, ORI-REVO, OrigamiDraw.
- `sources/ref/` — FOLD spec and API, Origami Simulator README (verbatim).
- `sources/samples/` — `crane-sequence.fold` (37 frames, one per step), classic bases as SVG/FOLD.
- `sources/origamidraw/` — OrigamiDraw source (diagram symbols and arrows).
- `sources/fetch-sources.sh` — clones upstream repos at pinned commits; run it into `./vendor` (git-ignored).

## Data conventions
- **FOLD (JSON) is the internal format everywhere.** One teaching step = one frame in `file_frames`.
- Library data: `data/library/<model-id>/model.json` + `steps/NNN.png|svg`. Schemas in `data/schema/`.
- Book PDFs are never committed. Location from `.env`: `ORIGAMI_LIBRARY_DIR` (owner's PC: `D:\literature\کتاب\Origami`; books in subfolder `متن ها و تصاویر`). Library books for now: *Works of Hideo Komatsu* (primary), *Origami Essence* (second). Paths contain Persian characters and spaces — always quote them and use UTF-8.

## Default stack (change only with a reason recorded in decisions.md)
- App: Vite + React + TypeScript, PWA; three.js for 3D; i18n with fa (RTL) and en.
- Origami libs: `fold` (npm), `rabbit-ear` (npm), Origami Simulator code adapted from `vendor/OrigamiSimulator` (old global-style JS; wrap it as a module).
- Design engines: BP Studio core (`vendor/box-pleating-studio`, TypeScript, Web Worker); TreeMaker model (`vendor/treemaker/Source/tmModel`, C++, no GUI dependency) only if needed, e.g. via WebAssembly.
- Tools/pipelines: Python 3 (PyMuPDF, OpenCV, numpy, scikit-image) under `tools/`, in a venv.
- Storage in app: IndexedDB. Mobile wrappers later.

## Known facts that affect implementation
- Origami Simulator folds all creases at once, not step by step — step playback must load one frame at a time.
- `fold-convert --flat-fold` (FOLD) and ORIPA CLI `--fold` compute folded states from a crease pattern.
- Rabbit Ear has `graph/fold/flatFold.js`, classic bases in `fold/bases.js`, diagram arrows in `diagrams/`, layer solver in `layer/`.
- Book PDFs are raster scans; the library pipeline crops one box per step and uses step numbers on the page.

## Don't
- Don't commit `vendor/`, book PDFs, or `.env`.
- Don't rewrite upstream algorithms when a library function exists.
- Don't expand scope beyond the current task file.
