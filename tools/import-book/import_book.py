"""Book importer (L0): PDF → Model Packages with one image per step (task 003, core-design §10).

Usage (from the repo root):  npm run import:book -- <book-slug> [--pages 15-40] [--no-cache]
Config per book: tools/import-book/books/<slug>.yaml. Output (not committed):
  $ORIGAMI_LIBRARY_OUT/<slug>/book.json, _pages/NNNN.jpg, _ocr/NNNN.json, <model-id>/model.json + images/

Pipeline per page: render at the scan's own resolution → OCR (RapidOCR, cached) → step markers
(numbers) → drawing clusters (ink minus text and frame lines, closed, connected components) →
assign each cluster to a step → captions (English lines) → one box per step.
Model boundaries come from title blocks ("Difficulty" / "Level" …).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import fitz  # PyMuPDF
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

# ----------------------------------------------------------------------------------------------
# Config and paths


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                env[m.group(1)] = m.group(2)
    env.update({k: v for k, v in os.environ.items() if k.startswith("ORIGAMI_")})
    return env


def library_out(env: dict[str, str]) -> Path:
    if env.get("ORIGAMI_LIBRARY_OUT"):
        return (ROOT / env["ORIGAMI_LIBRARY_OUT"]).resolve()
    return Path(env["ORIGAMI_LIBRARY_DIR"]) / "library"


def imwrite(path, img, params=()) -> None:
    """OpenCV cannot open non-ASCII Windows paths (the library folder is under …/کتاب/…): encode in memory."""
    ok, buf = cv2.imencode(Path(path).suffix, img, list(params))
    if not ok:
        raise RuntimeError(f"cannot encode {path}")
    Path(path).write_bytes(buf.tobytes())


def imread_gray(path) -> np.ndarray:
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_GRAYSCALE)


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "model"


# ----------------------------------------------------------------------------------------------
# Geometry helpers (boxes are [x, y, w, h] in page-render pixels)


def union(boxes):
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    return [x0, y0, x1 - x0, y1 - y0]


def rect_gap(a, b):
    """Euclidean gap between two rectangles (0 if they touch or overlap)."""
    dx = max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]), 0)
    dy = max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]), 0)
    return math.hypot(dx, dy)


def center(b):
    return (b[0] + b[2] / 2, b[1] + b[3] / 2)


# ----------------------------------------------------------------------------------------------
# OCR


_ocr_engine = None


def engine():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr import RapidOCR

        _ocr_engine = RapidOCR()
    return _ocr_engine


def _ocr(gray: np.ndarray, dx=0, dy=0) -> list[dict]:
    # Flags are passed every time: RapidOCR keeps the last call's use_det/use_rec settings.
    r = engine()(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR), use_det=True, use_cls=True, use_rec=True)
    lines = []
    for box, txt, score in zip(r.boxes if r.boxes is not None else [], r.txts or [], r.scores or []):
        x0, y0 = float(box[:, 0].min()) + dx, float(box[:, 1].min()) + dy
        x1, y1 = float(box[:, 0].max()) + dx, float(box[:, 1].max()) + dy
        lines.append({"box": [round(x0), round(y0), round(x1 - x0), round(y1 - y0)], "text": txt, "score": round(float(score), 3)})
    return lines


def _iou(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / min(a[2] * a[3], b[2] * b[3]) if inter else 0.0


def ocr_page(gray: np.ndarray, tiles: bool = False) -> list[dict]:
    """Whole page; optionally also overlapping tiles (lines added where nothing overlaps).
    Tiles roughly double the time and the per-drawing corner pass finds most of what they add."""
    lines = _ocr(gray)
    if not tiles:
        return lines
    H, W = gray.shape
    rows, cols, ov = 3, 2, 0.15
    th, tw = int(H / rows * (1 + ov)), int(W / cols * (1 + ov))
    for r_ in range(rows):
        for c_ in range(cols):
            y0 = min(H - th, int(r_ * H / rows - (th - H / rows) / 2)) if r_ else 0
            x0 = min(W - tw, int(c_ * W / cols - (tw - W / cols) / 2)) if c_ else 0
            y0, x0 = max(0, y0), max(0, x0)
            for l in _ocr(gray[y0 : y0 + th, x0 : x0 + tw], x0, y0):
                if not any(_iou(l["box"], m["box"]) > 0.3 for m in lines):
                    lines.append(l)
    return lines


# ----------------------------------------------------------------------------------------------
# Text classification

EN_WORDS = set(
    "the and to of a in on fold folds folding valley mountain crease unfold unfolded through layer layers flap flaps point points "
    "side sides edge edges top bottom front back behind turn over repeat other at it with as so that is be from up down "
    "corner corners center centre line lines squash reverse inside outside petal sink open close swing rotate model "
    "rabbit ear pleat crimp into this then all along between both left right half first next model's only".split()
)
ES_WORDS = set(
    "el la los las de del en y a con que por para un una doblar doblez dobleces valle monte marcar abrir aplastar hacia "
    "arriba abajo punta puntas capa capas lado lados todas todos repetir otro otra girar color oscuro medio través "
    "permitiendo rote incorporando revertidos hundir invertir cerrar dar vuelta".split()
)


def ascii_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    return sum(c.isascii() for c in letters) / len(letters) if letters else 0.0


def english_score(s: str) -> float:
    words = re.findall(r"[a-záéíóúñü'’]+", s.lower())
    if not words:
        return 0.0
    en = sum(w in EN_WORDS for w in words)
    es = sum(w in ES_WORDS for w in words)
    return (en - es) / len(words)


def is_english_line(s: str, mode: str) -> bool:
    if ascii_ratio(s) < 0.8:
        return False
    if mode == "japanese+english":
        return True
    # Spanish + English: Spanish has accents and Spanish words; English the English ones.
    if re.search(r"[áéíóúñ¿¡]", s.lower()):
        return False
    return english_score(s) >= 0


# ----------------------------------------------------------------------------------------------
# Page analysis


@dataclass
class Marker:
    label: str
    box: list
    caption_start: str = ""
    src: str = "ocr"


@dataclass
class StepBox:
    label: str
    page: int
    marker: list
    parts: list = field(default_factory=list)
    caption_lines: list = field(default_factory=list)

    def bbox(self, pad, W, H):
        b = union([self.marker, *self.parts, *[l["box"] for l in self.caption_lines]])
        x0, y0 = max(0, b[0] - pad), max(0, b[1] - pad)
        x1, y1 = min(W, b[0] + b[2] + pad), min(H, b[1] + b[3] + pad)
        return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def recognize(crop: np.ndarray) -> tuple[str, float]:
    """Text recognition only (no detection) on a small crop."""
    r = engine()(cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR), use_det=False, use_cls=False, use_rec=True)
    txts = getattr(r, "txts", None) or []
    scores = getattr(r, "scores", None) or []
    return (txts[0], float(scores[0])) if txts else ("", 0.0)


def missed_numbers(gray, lines, median_h, cfg) -> list[Marker]:
    """Large digits the OCR detector skipped (isolated short numbers like "1"): find number-sized
    ink blobs outside every OCR line, group them into 1–3 digit runs, recognise each crop."""
    ink = ink_mask(gray, [], *gray.shape[::-1], cfg)  # frame lines removed, text kept
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    # Glyph heights are ~0.75 of OCR box heights; step numbers are ~1.4× caption text.
    lo, hi = 0.95 * median_h, 2.0 * median_h
    occupied = [l["box"] for l in lines]
    cands = []
    for x, y, w, h, a in stats[1:]:
        if not (lo <= h <= hi and 0.22 * h <= w <= 1.0 * h):
            continue
        if any(rect_gap([x, y, w, h], b) == 0 for b in occupied):
            continue
        if a < 0.25 * w * h:  # thin outline, not a bold digit
            continue
        # Step numbers stand apart: no ink just left of, above or below them (arrow shafts fail this).
        H_, W_ = ink.shape
        strips = [
            ink[y : y + h, max(0, x - int(0.6 * h)) : x],
            ink[max(0, y - int(0.6 * h)) : y, x : x + w],
            ink[y + h : min(H_, y + h + int(0.4 * h)), x : x + w],
        ]
        if any(st.size and (st > 0).mean() > 0.04 for st in strips):
            continue
        cands.append([int(x), int(y), int(w), int(h)])
    cands.sort(key=lambda b: (b[0]))
    groups: list[list] = []
    for b in cands:
        for g in groups:
            last = g[-1]
            if len(g) < 3 and abs(b[1] - last[1]) < 0.3 * last[3] and 0 <= b[0] - (last[0] + last[2]) < 0.5 * last[3]:
                g.append(b)
                break
        else:
            groups.append([b])
    found = []
    H, W = gray.shape
    for g in groups:
        x, y, w, h = union(g)
        pad = int(0.35 * h)
        crop = np.full((h + 2 * pad, w + 2 * pad), 255, np.uint8)
        crop[pad : pad + h, pad : pad + w] = gray[y : y + h, x : x + w]
        txt, score = recognize(crop)
        txt = txt.strip().replace("O", "0").replace("o", "0").replace("l", "1").replace("I", "1")
        if re.fullmatch(r"\d{1,3}", txt) and score >= 0.8 and int(txt) > 0:
            found.append(Marker(txt, [x, y, w, h], src="blob"))
    return found


def find_markers(lines, W, H, cfg, gray=None) -> tuple[list[Marker], list[dict]]:
    """Step markers and the remaining text lines (headers and footers dropped)."""
    top, bottom = cfg.get("header_band", 0.035) * H, (1 - cfg.get("footer_band", 0.05)) * H
    body = [l for l in lines if top < l["box"][1] and l["box"][1] + l["box"][3] < bottom]
    heights = sorted(l["box"][3] for l in body) or [20]
    median_h = heights[len(heights) // 2]
    markers, text = [], []
    for l in body:
        t = l["text"].strip()
        if cfg["marker"] == "number":
            m = re.fullmatch(r"(\d{1,3})", t)
            if m and l["box"][3] >= cfg.get("number_height_ratio", 1.4) * median_h and int(m.group(1)) > 0:
                markers.append(Marker(m.group(1), l["box"]))
                continue
        else:  # numbered caption: "12. Doblar en valle."
            m = re.match(r"^(\d{1,3})\s*[.,]\s*(.*)$", t)
            if m and int(m.group(1)) > 0 and not re.match(r"^\d+\s*[.,]\s*\d", t):
                markers.append(Marker(m.group(1), l["box"], m.group(2)))
                continue
        text.append(l)
    if cfg["marker"] == "number" and gray is not None:
        inner = [m for m in missed_numbers(gray, lines, median_h, cfg) if top < m.box[1] and m.box[1] + m.box[3] < bottom]
        markers.extend(inner)
    return dedupe_markers(markers), text


def dedupe_markers(markers: list[Marker]) -> list[Marker]:
    """Whole-page and tile OCR can read the same number twice (sometimes differently): keep the first."""
    kept: list[Marker] = []
    for m in markers:
        if not any(_iou(m.box, k.box) > 0.3 for k in kept):
            kept.append(m)
    return kept


def caption_numbers(gray, clusters, markers, W) -> list[Marker]:
    """Second chance for short captions like "1." under a drawing that has no marker below it."""
    found = []
    H = gray.shape[0]
    for c in clusters:
        x, y, w, h = c["box"]
        if any(x - 0.05 * W < m.box[0] < x + w and y + 0.3 * h < m.box[1] < y + h + 0.05 * W for m in markers + found):
            continue
        x0, y0, x1, y1 = max(0, int(x - 0.03 * W)), max(0, int(y + 0.6 * h)), min(W, int(x + w + 0.03 * W)), min(H, int(y + h + 0.06 * W))
        for l in _ocr(gray[y0:y1, x0:x1], x0, y0):
            m = re.match(r"^(\d{1,3})\s*[.,]\s*(.*)$", l["text"].strip())
            if m and int(m.group(1)) > 0 and l["score"] >= 0.8 and not any(_iou(l["box"], k.box) > 0.3 for k in markers + found):
                found.append(Marker(m.group(1), l["box"], m.group(2), src="caption"))
    return found


def corner_numbers(gray, clusters, markers, median_h, W, cfg) -> list[Marker]:
    """Second chance for numbers touching their drawing: OCR the top-left corner of every drawing
    that has no marker near it (the detector finds them in a small view)."""
    found = []
    H = gray.shape[0]
    for c in clusters:
        x, y, w, h = c["box"]
        if any(rect_gap(m.box, c["box"]) < 0.04 * W and m.box[1] < y + 0.4 * h for m in markers + found):
            continue
        x0, y0 = max(0, int(x - 0.08 * W)), max(0, int(y - 0.07 * W))
        x1, y1 = min(W, int(x + max(0.25 * W, 0.6 * w))), min(H, int(y + 0.12 * W))
        for l in _ocr(gray[y0:y1, x0:x1], x0, y0):
            t = l["text"].strip()
            if re.fullmatch(r"\d{1,3}", t) and l["box"][3] >= cfg.get("number_height_ratio", 1.4) * median_h and int(t) > 0 and l["score"] >= 0.8:
                if not any(_iou(l["box"], m.box) > 0.3 for m in markers + found):
                    found.append(Marker(t, l["box"], src="corner"))
    return found


def flatten(gray: np.ndarray) -> np.ndarray:
    """Divide out uneven lighting (gutter shadows of book scans) so only real lines stay dark."""
    k = max(15, (gray.shape[1] // 40) | 1)
    bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    bg = cv2.GaussianBlur(bg, (k, k), 0)
    return cv2.divide(gray, bg, scale=255)


def ink_mask(gray: np.ndarray, text_boxes: list, W: int, H: int, cfg: dict) -> np.ndarray:
    """Binary ink without text, page frames and scan borders."""
    ink = cv2.adaptiveThreshold(flatten(gray), 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 15)
    for x, y, w, h in text_boxes:
        cv2.rectangle(ink, (x - 3, y - 3), (x + w + 3, y + h + 3), 0, -1)
    # Long straight frame lines would join every drawing on the page.
    for k in [(int(W * cfg.get("frame_h", 0.25)), 1), (1, int(H * cfg.get("frame_v", 0.2)))]:
        lines = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, k))
        ink = cv2.subtract(ink, cv2.dilate(lines, np.ones((3, 3), np.uint8)))
    # Scan borders / gutter shadows: big blobs touching the page edge.
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        touches = x <= 2 or y <= 2 or x + w >= W - 2 or y + h >= H - 2
        if touches and (h > 0.3 * H or w > 0.3 * W):
            ink[lab == i] = 0
    return ink


def drawing_clusters(ink: np.ndarray, W: int, cfg) -> tuple[list, np.ndarray, np.ndarray]:
    """Connected drawings: components of the ink after closing small gaps."""
    k = max(3, int(W * cfg.get("close", 0.012)))
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    closed = cv2.dilate(closed, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    min_side = W * cfg.get("min_drawing", 0.04)
    clusters = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        H_ = ink.shape[0]
        touches = x <= 2 or y <= 2 or x + w >= W - 2 or y + h >= H_ - 2
        if touches and (w > 0.4 * W or h > 0.4 * H_):
            continue  # scan edges, gutter lines and page frames joined by the closing
        if w * h > 0.5 * W * H_:
            continue
        if max(w, h) >= min_side and a >= (min_side * 0.5) ** 2:
            clusters.append({"id": i, "box": [int(x), int(y), int(w), int(h)]})
    return clusters, lab, closed


def assign(markers: list[Marker], clusters: list, lab: np.ndarray, W: int, H: int, cfg):
    """Each drawing cluster → the step whose marker is nearest in the expected direction."""
    steps = [StepBox(m.label, 0, m.box) for m in markers]
    if not steps:
        return steps, clusters
    max_gap = cfg.get("max_gap", 0.12) * W
    below = cfg["marker"] == "numbered-caption"  # marker sits under its drawing
    unassigned = []
    for c in clusters:
        cb = c["box"]
        if below:
            # Captions sit just under their drawing: markers in a band under (or inside) the cluster.
            inside = [i for i, m in enumerate(markers) if cb[0] - 0.05 * W < m.box[0] < cb[0] + cb[2] and cb[1] + 0.3 * cb[3] < m.box[1] < cb[1] + cb[3] + 0.04 * W]
        else:
            inside = [i for i, m in enumerate(markers) if rect_gap(m.box, [cb[0] - 4, cb[1] - 4, cb[2] + 8, cb[3] + 8]) == 0]
        if len(inside) >= 2:
            # Two drawings joined (e.g. by an arrow): split the cluster's pixels between the markers.
            ys, xs = np.nonzero(lab[cb[1] : cb[1] + cb[3], cb[0] : cb[0] + cb[2]] == c["id"])
            xs, ys = xs + cb[0], ys + cb[1]
            off = cfg.get("anchor_offset", 0.06) * W
            if below:  # drawing above its caption
                anchors = np.array([[m.box[0] + 0.5 * m.box[2], m.box[1] - 0.12 * W] for m in (markers[i] for i in inside)])
            else:  # drawing below-right of its number
                anchors = np.array([[m.box[0] + m.box[2] + off, m.box[1] + m.box[3] + off] for m in (markers[i] for i in inside)])
            d = (xs[:, None] - anchors[None, :, 0]) ** 2 + (ys[:, None] - anchors[None, :, 1]) ** 2
            owner = d.argmin(axis=1)
            for j, i in enumerate(inside):
                sel = owner == j
                if sel.sum() > 50:
                    steps[i].parts.append([int(xs[sel].min()), int(ys[sel].min()), int(xs[sel].max() - xs[sel].min()), int(ys[sel].max() - ys[sel].min())])
            continue
        best, best_score = None, float("inf")
        for i, m in enumerate(markers):
            g = rect_gap(m.box, cb)
            mc, cc = center(m.box), center(cb)
            if below:
                # Caption marker should be below the drawing and horizontally under it.
                if mc[1] < cb[1] + 0.3 * cb[3]:
                    continue
                score = g + 0.5 * abs(mc[0] - cc[0])  # caption centred under its drawing
            else:
                # Number at the drawing's top-left: the drawing must reach below and right of it.
                if cb[1] + cb[3] < m.box[1] + 0.5 * m.box[3] or cb[0] + cb[2] < m.box[0]:
                    continue
                score = g + (0.5 * max(0, m.box[1] - cc[1])) + (0.3 * max(0, m.box[0] - cc[0]))
            if score < best_score:
                best, best_score = i, score
        if best is not None and rect_gap(markers[best].box, cb) <= max_gap:
            steps[best].parts.append(cb)
        else:
            unassigned.append(c)
    return steps, unassigned


def group_lines(lines):
    """Text lines → blocks of vertically adjacent lines."""
    blocks: list[list[dict]] = []
    for l in sorted(lines, key=lambda l: (l["box"][1], l["box"][0])):
        x, y, w, h = l["box"]
        for b in blocks:
            last = b[-1]["box"]
            if 0 <= y - (last[1] + last[3]) < 1.2 * h and abs(x - last[0]) < 3 * h:
                b.append(l)
                break
        else:
            blocks.append([l])
    return blocks


def attach_captions(steps: list[StepBox], markers: list[Marker], text: list, W: int, cfg):
    mode = cfg.get("captions", "japanese+english")
    if cfg["marker"] == "numbered-caption":
        # Caption = rest of the marker line + the lines directly under it.
        used = set()
        for s, m in zip(steps, markers):
            s.caption_lines.append({"box": m.box, "text": m.caption_start, "first": True})
            x, y, w, h = m.box
            cur_bottom = y + h
            for _ in range(4):
                nxt = [
                    (i, l)
                    for i, l in enumerate(text)
                    if i not in used and 0 <= l["box"][1] - cur_bottom < 1.2 * h and abs(l["box"][0] - x) < 0.06 * W
                ]
                if not nxt:
                    break
                i, l = min(nxt, key=lambda p: p[1]["box"][1])
                used.add(i)
                s.caption_lines.append(l)
                cur_bottom = l["box"][1] + l["box"][3]
        return
    for block in group_lines(text):
        bb = union([l["box"] for l in block])
        best, best_g = None, cfg.get("caption_gap", 0.08) * W
        for s in steps:
            g = rect_gap(union([s.marker, *s.parts]), bb)
            if g < best_g:
                best, best_g = s, g
        if best:
            best.caption_lines.extend(block)


def english_caption(s: StepBox, mode: str) -> str:
    out = []
    # Reading order: top to bottom (the marker line, if any, stays first).
    lines = sorted(s.caption_lines, key=lambda l: (not l.get("first"), l["box"][1] + l["box"][3] / 2))
    for l in lines:
        t = l["text"].strip()
        if not t:
            continue
        if l.get("first") and mode == "spanish+english":
            # The marker line itself is Spanish ("12. Doblar …") unless it is already English.
            if is_english_line(t, mode) and english_score(t) > 0:
                out.append(t)
            continue
        if is_english_line(t, mode):
            out.append(t)
    return re.sub(r"\s+", " ", " ".join(out)).strip()


# ----------------------------------------------------------------------------------------------
# Title blocks


def title_info(lines, gray, W, H, cfg) -> dict | None:
    texts = " ".join(l["text"] for l in lines)
    if not all(re.search(p, texts, re.I) for p in cfg["title_markers"]):
        return None
    info: dict = {}
    # Title region, without text bleeding in from the facing page at the left/right edge.
    region = [l for l in lines if l["box"][1] < cfg.get("title_region", 0.4) * H and 0.04 * W < l["box"][0] and l["box"][0] + l["box"][2] < 0.98 * W]
    latin = [l for l in region if ascii_ratio(l["text"]) > 0.9 and len(l["text"].strip()) >= 3]
    skip = re.compile(cfg.get("title_skip", r"^(created|difficulty|paper|first|level|nivel|ratio|favorite|papel|recommended|tama|comment|origami|works)"), re.I)
    cands = [l for l in latin if not skip.search(l["text"].strip()) and re.fullmatch(r"[^\W\d_][^\W\d_ '\-]*(?: [^\W\d_'\-]+)*", l["text"].strip())]
    cands.sort(key=lambda l: -l["box"][3])
    if cfg.get("title_lines") == "spanish-then-english":
        # Big Spanish title, then the English one (often italic, smaller) right below.
        if cands:
            es = cands[0]
            below = [l for l in cands[1:] if 0 < l["box"][1] - es["box"][1] < 4 * es["box"][3] and l["box"][3] > 0.5 * es["box"][3]]
            en = min(below, key=lambda l: l["box"][1]) if below else None
            info["title_es"] = es["text"].strip().title()
            # Stylised italic English titles are often misread: use them only if they are plain words.
            ok = en and re.fullmatch(r"[A-Za-z][A-Za-z '\-]{2,}", en["text"].strip())
            info["title"] = en["text"].strip().title() if ok else info["title_es"]
    elif cands:
        info["title"] = cands[0]["text"].strip()
    size = re.search(cfg.get("size_pattern", r"(\d+\s*[x×]\s*\d+\s*cm)"), texts, re.I)
    if size:
        info["size"] = re.sub(r"\s+", "", size.group(1)).replace("×", "x")
    lvl = cfg.get("difficulty")
    if lvl and lvl["from"] == "level":
        m = re.search(r"Level\s*(\d)", texts, re.I)
        if m:
            info["difficulty"] = {"scale": lvl["scale"], "value": int(m.group(1))}
    elif lvl and lvl["from"] == "stars":
        d = next((l for l in lines if re.search(r"Difficulty", l["text"], re.I)), None)
        if d:
            x, y, w, h = d["box"]
            x0, x1 = x + w, min(W, x + w + int(0.35 * W))
            y0, y1 = max(0, y - h // 2), min(H, y + h + h // 2)
            roi = cv2.threshold(gray[y0:y1, x0:x1], 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
            n, _, stats, _ = cv2.connectedComponentsWithStats(roi, 8)
            stars = [s for s in stats[1:] if 0.5 * h <= s[3] <= 1.6 * h and 0.5 * h <= s[2] <= 1.6 * h]
            info["difficulty"] = {"scale": lvl["scale"], "value": len(stars)}
    return info


# ----------------------------------------------------------------------------------------------
# Main


def render(doc, pno: int, zoom: float) -> np.ndarray:
    pix = doc[pno - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w).copy()


def title_bottom(lines, H, cfg) -> float:
    """Bottom of a title block (0 if the page has none): lowest line with title-block words."""
    pat = re.compile(cfg.get("title_block_words", r"Created|Difficulty|Paper Size|First Published|Magazine|Level|Nivel|ratio|Recommended|Comments|Favorite|Tama|Comentarios"), re.I)
    ys = [l["box"][1] + l["box"][3] for l in lines if pat.search(l["text"]) and l["box"][1] < 0.5 * H]
    return max(ys) if ys else 0.0


def analyse_page(gray, lines, cfg, is_title=False):
    H, W = gray.shape
    markers, text = find_markers(lines, W, H, cfg, gray)
    top = title_bottom(lines, H, cfg) if is_title else 0.0
    if top:
        markers = [m for m in markers if m.box[1] > top]
        text = [l for l in text if l["box"][1] > top]
    ink = ink_mask(gray, [l["box"] for l in lines], W, H, cfg)
    clusters, lab, _ = drawing_clusters(ink, W, cfg)
    above = [c for c in clusters if c["box"][1] + c["box"][3] * 0.5 < top]
    clusters = [c for c in clusters if c not in above]
    if cfg["marker"] == "number":
        body = [l["box"][3] for l in lines if l["box"][1] > top] or [20]
        median_h = sorted(body)[len(body) // 2]
        markers += corner_numbers(gray, clusters, markers, median_h, W, cfg)
    else:
        markers += caption_numbers(gray, clusters, markers, W)
    steps, unassigned = assign(markers, clusters, lab, W, H, cfg)
    unassigned += above
    attach_captions(steps, markers, text, W, cfg)
    return steps, unassigned, ink, markers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("book")
    ap.add_argument("--pages", help="only these PDF pages, e.g. 15-40 (models are cut at the range ends)")
    ap.add_argument("--no-cache", action="store_true", help="redo OCR")
    ap.add_argument("--debug", help="write pages with boxes drawn to this folder")
    ap.add_argument("--tiles", action="store_true", help="also OCR overlapping tiles (slower)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    cfg = yaml.safe_load((HERE / "books" / f"{args.book}.yaml").read_text(encoding="utf-8"))
    env = read_env()
    pdf = Path(env["ORIGAMI_LIBRARY_DIR"]) / cfg["pdf"]
    out = library_out(env) / cfg["slug"]
    for d in ["_pages", "_ocr"]:
        (out / d).mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf)
    first, last = cfg["pages"]
    if args.pages:
        a, b = args.pages.split("-")
        first, last = max(first, int(a)), min(last, int(b))
    skip = set(cfg.get("skip", []))

    models: list[dict] = []
    current = None
    debug = Path(args.debug) if args.debug else None
    if debug:
        debug.mkdir(parents=True, exist_ok=True)
    for pno in range(first, last + 1):
        if pno in skip:
            continue
        gray = render(doc, pno, cfg["zoom"])
        H, W = gray.shape
        imwrite(out / "_pages" / f"{pno:04d}.jpg", gray, [cv2.IMWRITE_JPEG_QUALITY, 88])
        cache = out / "_ocr" / f"{pno:04d}.json"
        if cache.exists() and not args.no_cache:
            lines = json.loads(cache.read_text(encoding="utf-8"))
        else:
            lines = ocr_page(gray, args.tiles)
            cache.write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")
        info = title_info(lines, gray, W, H, cfg)
        steps, unassigned, ink, markers = analyse_page(gray, lines, cfg, info is not None)
        if args.debug:
            print("   markers:", [(m.label, m.src, m.box[:2]) for m in markers])
        if info is not None:
            title = info.get("title") or f"Model p{pno}"
            current = {"title": title, "info": info, "first": pno, "last": pno, "steps": [], "extras": []}
            models.append(current)
            # Unassigned big drawings on a title page: crease pattern (line art) or photo (filled).
            for c in unassigned:
                x, y, w, h = c["box"]
                if min(w, h) < 0.12 * W:
                    continue
                fill = float((ink[y : y + h, x : x + w] > 0).mean())
                dark = float((gray[y : y + h, x : x + w] < 160).mean())
                kind = "photo" if dark > 0.25 else "cp" if 0.7 < w / h < 1.4 else "other"
                current["extras"].append({"kind": kind, "page": pno, "bbox": c["box"], "fill": round(fill, 3)})
        if current is None:
            continue
        current["last"] = pno
        for s in steps:
            s.page = pno
            current["steps"].append((s, s.bbox(int(0.008 * W), W, H), english_caption(s, cfg.get("captions", "japanese+english"))))
        if debug:
            vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
            for s in steps:
                x, y, w, h = s.bbox(int(0.008 * W), W, H)
                cv2.rectangle(vis, (x, y), (x + w, y + h), (191, 95, 31), 3)
                cv2.putText(vis, s.label, (x + 4, y + 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (43, 57, 192), 2)
            for c in unassigned:
                x, y, w, h = c["box"]
                cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 160, 0), 2)
            imwrite(debug / f"{args.book}-{pno:04d}.jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 80])
        print(f"page {pno}: {len(steps)} steps {'[' + ', '.join(s.label for s in steps) + ']' if steps else ''}{'  TITLE ' + current['title'] if info else ''}", flush=True)

    write_packages(out, cfg, models)


def repair_labels(steps):
    """A label far outside its page's range or duplicated in the model (e.g. "15" read as "5"
    when an arc crosses the 1) becomes the missing number that ends with the same digits and
    fits the page; if none fits it is a misread (arrow glyph, annotation) and is dropped."""
    labels = [int(s.label) for s, _, _ in steps]
    present = set(labels)
    by_page: dict[int, list[int]] = {}
    for s, _, _ in steps:
        by_page.setdefault(s.page, []).append(int(s.label))
    hi = max(labels, default=0)
    for s, _, _ in steps:
        n = int(s.label)
        page_labels = sorted(by_page[s.page])
        others = [k for k in page_labels if k != n]
        if not others:
            continue
        lo_p, hi_p = min(others), max(others)
        dup = labels.count(n) > 1
        outlier = n < lo_p - 3 or n > hi_p + 3
        if not (dup or outlier):
            continue
        cands = [k for k in range(max(1, lo_p - 3), max(hi, hi_p) + 4) if k not in present and str(k).endswith(str(n)) and lo_p - 3 <= k <= hi_p + 3]
        if len(cands) == 1:
            present.discard(n) if labels.count(n) == 1 else None
            present.add(cands[0])
            s.label = str(cands[0])
        elif outlier:
            s.label = ""  # dropped below
    steps[:] = [t for t in steps if t[0].label]


def write_packages(out: Path, cfg, models):
    (out / "book.json").write_text(json.dumps({"slug": cfg["slug"], "title": cfg["title"], "pdf": cfg["pdf"]}, ensure_ascii=False, indent=2), encoding="utf-8")
    seen_ids: set[str] = set()
    summary = []
    pages_cache: dict[int, np.ndarray] = {}

    def page_img(p):
        if p not in pages_cache:
            pages_cache.clear()
            pages_cache[p] = imread_gray(out / "_pages" / f"{p:04d}.jpg")
        return pages_cache[p]

    for m in models:
        mid = slugify(m["title"])
        while mid in seen_ids:
            mid += "-2"
        seen_ids.add(mid)
        mdir = out / mid
        if mdir.exists():
            for f in (mdir / "images").glob("*"):
                f.unlink()
        (mdir / "images").mkdir(parents=True, exist_ok=True)
        repair_labels(m["steps"])
        steps = sorted(m["steps"], key=lambda t: (int(t[0].label), t[0].page))
        labels_seen: dict[str, int] = {}
        pkg_steps = []
        for s, box, caption in steps:
            n = labels_seen.get(s.label, 0)
            labels_seen[s.label] = n + 1
            sid = f"s{s.label}" + (chr(ord("a") + n) if n else "")
            fname = f"images/{sid}.png"
            x, y, w, h = box
            imwrite(mdir / fname, page_img(s.page)[y : y + h, x : x + w])
            step = {"id": sid, "label": s.label, "image": {"file": fname, "page": s.page, "bbox": box}, "level": "L0"}
            if caption:
                step["caption"] = {"original": caption, "lang": "en"}
            pkg_steps.append(step)
        extras = []
        for i, e in enumerate(m["extras"]):
            x, y, w, h = e["bbox"]
            fname = f"images/{e['kind']}-{i + 1}.png"
            imwrite(mdir / fname, page_img(e["page"])[y : y + h, x : x + w])
            extras.append({"kind": e["kind"], "file": fname, "page": e["page"], "bbox": e["bbox"]})
        info = m["info"]
        pkg = {
            "format": "origami-model-package/1",
            "id": mid,
            "title": m["title"],
            "designer": cfg["designer"],
            "source": {"book": cfg["title"], "pages": [m["first"], m["last"]], "note": "Imported automatically (task 003); review in the app."},
            "paper": {"shape": "square", **({"size": info["size"]} if info.get("size") else {})},
            "steps": pkg_steps,
        }
        if info.get("difficulty"):
            pkg["difficulty"] = info["difficulty"]
        if info.get("title_es"):
            pkg["source"]["note"] += f" Original title: {info['title_es']}."
        if extras:
            pkg["extras"] = extras
        if not pkg_steps:
            pkg["notes"] = "no steps detected"
        (mdir / "model.json").write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        nums = sorted({int(s.label) for s, _, _ in steps})
        missing = [k for k in range(1, (nums[-1] if nums else 0) + 1) if k not in nums]
        summary.append({"id": mid, "title": m["title"], "pages": [m["first"], m["last"]], "steps": len(pkg_steps), "max": nums[-1] if nums else 0, "missing": missing, "difficulty": info.get("difficulty")})
    (out / "_import-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(models)} models written to {out}")
    for s in summary:
        print(f"  {s['id']:<28} p{s['pages'][0]}-{s['pages'][1]}  steps {s['steps']:>3}/{s['max']:<3} missing {s['missing'][:12]}{'…' if len(s['missing']) > 12 else ''}")


if __name__ == "__main__":
    main()
