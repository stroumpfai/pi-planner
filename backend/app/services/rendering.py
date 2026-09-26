"""A minimal Pillow-backed 2D drawing canvas, replacing matplotlib's Figure/Axes
for the PI PNG exports (``pi_export.py``) and the sprint chart embedded in the
readout PDF (``pi_report.py``).

Only the primitives those two call sites need are implemented: filled/outlined
rectangles, axis-aligned solid or dashed lines, plain or rotated text, and
horizontal bars (drawn as rectangles). Everything is rendered at
``supersample``x the final pixel size and downsampled once with LANCZOS at
the end, approximating matplotlib's Agg-backend antialiasing.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Union

from PIL import Image, ImageColor, ImageDraw, ImageFont

_FONT_DIR = Path(__file__).resolve().parent.parent / "data" / "fonts"
_REGULAR_FONT = _FONT_DIR / "DejaVuSans.ttf"
_BOLD_FONT = _FONT_DIR / "DejaVuSans-Bold.ttf"

_PT_PER_IN = 72.0
# Dash pattern for dashed lines, in points (converted to px like line widths).
_DASH_LEN_PT = 4.0
_DASH_GAP_PT = 3.0

HAlign = Literal["left", "center", "right"]
VAlign = Literal["top", "center"]

_ANCHOR_H: dict[HAlign, str] = {"left": "l", "center": "m", "right": "r"}
_ANCHOR_V: dict[VAlign, str] = {"top": "t", "center": "m"}

_RGBA = tuple[int, int, int, int]

_font_cache: dict[tuple[bool, int], ImageFont.FreeTypeFont] = {}


def _font(bold: bool, size_px: int) -> ImageFont.FreeTypeFont:
    key = (bold, max(1, size_px))
    font = _font_cache.get(key)
    if font is None:
        font = ImageFont.truetype(str(_BOLD_FONT if bold else _REGULAR_FONT), size=key[1])
        _font_cache[key] = font
    return font


def text_width_in(text: str, fontsize: float, *, bold: bool = False, dpi: float = 150.0) -> float:
    """Return the rendered width of `text` at `fontsize` (points, at `dpi`), in
    inches — used to truncate labels to a pixel-accurate fit instead of an
    approximate chars-per-inch heuristic."""
    size_px = max(1, round(fontsize * dpi / _PT_PER_IN))
    return _font(bold, size_px).getlength(text) / dpi


def _rgba(color: str, alpha: float = 1.0) -> _RGBA:
    r, g, b = ImageColor.getrgb(color)[:3]
    return (r, g, b, round(alpha * 255))


@dataclass
class _RectOp:
    box: tuple[float, float, float, float]  # x0, y0, x1, y1 in canvas px
    facecolor: str | None
    edgecolor: str | None
    linewidth_px: int


@dataclass
class _LineOp:
    p0: tuple[float, float]
    p1: tuple[float, float]
    color: str
    linewidth_px: int
    dashed: bool
    alpha: float
    dash_px: float
    gap_px: float


@dataclass
class _TextOp:
    pos: tuple[float, float]
    text: str
    ha: HAlign
    va: VAlign
    size_px: int
    bold: bool
    color: str
    rotation: float


_Op = Union[_RectOp, _LineOp, _TextOp]


class DataAxes:
    """One rectangular region of the canvas with its own data-unit coordinates,
    mirroring a single matplotlib ``Axes``."""

    def __init__(self, canvas: "Canvas", region_px: tuple[float, float, float, float]) -> None:
        self._canvas = canvas
        self._region = region_px
        self._xlim = (0.0, 1.0)
        self._ylim = (0.0, 1.0)

    def set_xlim(self, lo: float, hi: float) -> None:
        self._xlim = (lo, hi)

    def set_ylim(self, lo: float, hi: float) -> None:
        self._ylim = (lo, hi)

    def axis_off(self) -> None:
        """No-op — this adapter never draws ticks, tick labels or spines."""

    def _to_px(self, x: float, y: float) -> tuple[float, float]:
        rx0, ry0, rx1, ry1 = self._region
        xlo, xhi = self._xlim
        ylo, yhi = self._ylim
        px = rx0 + (x - xlo) / (xhi - xlo) * (rx1 - rx0)
        py = ry1 - (y - ylo) / (yhi - ylo) * (ry1 - ry0)  # data y grows up, image y grows down
        return px, py

    def rect(self, x: float, y: float, w: float, h: float, *,
              facecolor: str | None = None, edgecolor: str | None = None,
              linewidth: float = 1.0, zorder: float = 1.0) -> None:
        x0, y1 = self._to_px(x, y)
        x1, y0 = self._to_px(x + w, y + h)
        lw_px = self._canvas._pt_px(linewidth) if edgecolor else 0
        self._canvas._add(zorder, _RectOp((x0, y0, x1, y1), facecolor, edgecolor, lw_px))

    def barh(self, y: float, width: float, *, left: float = 0.0, color: str,
              height: float, edgecolor: str = "none", linewidth: float = 0.0,
              zorder: float = 1.0) -> None:
        ec = None if edgecolor == "none" else edgecolor
        self.rect(left, y - height / 2, width, height, facecolor=color,
                   edgecolor=ec, linewidth=linewidth, zorder=zorder)

    def hline(self, y: float, *, color: str = "black", linewidth: float = 1.0,
               linestyle: str = "solid", alpha: float = 1.0, zorder: float = 2.0) -> None:
        xlo, xhi = self._xlim
        self._line(self._to_px(xlo, y), self._to_px(xhi, y), color, linewidth,
                   linestyle != "solid", alpha, zorder)

    def vline(self, x: float, *, color: str = "black", linewidth: float = 1.0,
               linestyle: str = "solid", alpha: float = 1.0, zorder: float = 2.0) -> None:
        ylo, yhi = self._ylim
        self._line(self._to_px(x, ylo), self._to_px(x, yhi), color, linewidth,
                   linestyle != "solid", alpha, zorder)

    def _line(self, p0: tuple[float, float], p1: tuple[float, float], color: str,
              linewidth: float, dashed: bool, alpha: float, zorder: float) -> None:
        lw_px = max(1, self._canvas._pt_px(linewidth))
        dash_px = self._canvas._pt_px_f(_DASH_LEN_PT)
        gap_px = self._canvas._pt_px_f(_DASH_GAP_PT)
        self._canvas._add(zorder, _LineOp(p0, p1, color, lw_px, dashed, alpha, dash_px, gap_px))

    def text(self, x: float, y: float, s: str, *, ha: HAlign = "left", va: VAlign = "top",
              fontsize: float = 8.0, bold: bool = False, color: str = "black",
              rotation: float = 0.0, zorder: float = 3.0, clip_on: bool = True) -> None:
        px, py = self._to_px(x, y)
        size_px = self._canvas._pt_px(fontsize)
        self._canvas._add(zorder, _TextOp((px, py), s, ha, va, size_px, bold, color, rotation))


class Canvas:
    """The full drawing surface. Build sub-regions with ``sub``/``rows``, draw
    onto the ``DataAxes`` they return, then call ``to_png``."""

    def __init__(self, width_in: float, height_in: float, dpi: float = 150.0,
                 supersample: int = 3) -> None:
        self.dpi = dpi
        self.supersample = supersample
        self.width_px = max(1, round(width_in * dpi))
        self.height_px = max(1, round(height_in * dpi))
        self._super_w = self.width_px * supersample
        self._super_h = self.height_px * supersample
        self._ops: list[tuple[float, int, _Op]] = []
        self._seq = 0

    def _pt_px(self, pt: float) -> int:
        return max(1, round(self._pt_px_f(pt)))

    def _pt_px_f(self, pt: float) -> float:
        return pt * self.dpi / _PT_PER_IN * self.supersample

    def _add(self, zorder: float, op: _Op) -> None:
        self._seq += 1
        self._ops.append((zorder, self._seq, op))

    def sub(self, x0_in: float, y0_in: float, w_in: float, h_in: float) -> DataAxes:
        scale = self.dpi * self.supersample
        region = (x0_in * scale, y0_in * scale, (x0_in + w_in) * scale, (y0_in + h_in) * scale)
        return DataAxes(self, region)

    def rows(self, heights_in: list[float], *, x0_in: float = 0.0,
              width_in: float | None = None, gap_frac: float = 0.05) -> list[DataAxes]:
        """Stack axes top-to-bottom, mirroring a single-column ``GridSpec``
        with ``hspace=gap_frac`` (a fraction of the mean row height, matching
        matplotlib's ``GridSpec`` semantics)."""
        width = width_in if width_in is not None else self.width_px / self.dpi - x0_in
        gap = gap_frac * (sum(heights_in) / len(heights_in)) if len(heights_in) > 1 else 0.0
        axes = []
        y = 0.0
        for h in heights_in:
            axes.append(self.sub(x0_in, y, width, h))
            y += h + gap
        return axes

    def title(self, text: str, *, fontsize: float = 10.0, bold: bool = True) -> None:
        size_px = self._pt_px(fontsize)
        pos = (self._super_w / 2, size_px * 0.3)
        self._add(3.0, _TextOp(pos, text, "center", "top", size_px, bold, "black", 0.0))

    def to_png(self) -> bytes:
        base = Image.new("RGBA", (self._super_w, self._super_h), (255, 255, 255, 255))
        draw = ImageDraw.Draw(base)
        for _, _, op in sorted(self._ops, key=lambda t: (t[0], t[1])):
            _paint(base, draw, op)
        final = base.convert("RGB").resize((self.width_px, self.height_px), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        final.save(buf, format="PNG")
        return buf.getvalue()


def _paint(base: Image.Image, draw: ImageDraw.ImageDraw, op: _Op) -> None:
    if isinstance(op, _RectOp):
        _paint_rect(draw, op)
    elif isinstance(op, _LineOp):
        _paint_line(base, draw, op)
    else:
        _paint_text(base, draw, op)


def _paint_rect(draw: ImageDraw.ImageDraw, op: _RectOp) -> None:
    fill = _rgba(op.facecolor) if op.facecolor else None
    outline = _rgba(op.edgecolor) if op.edgecolor else None
    draw.rectangle(op.box, fill=fill, outline=outline, width=op.linewidth_px if outline else 0)


def _paint_line(base: Image.Image, draw: ImageDraw.ImageDraw, op: _LineOp) -> None:
    if op.alpha >= 1.0:
        _draw_line_segments(draw, op, _rgba(op.color, 1.0))
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    _draw_line_segments(ImageDraw.Draw(layer), op, _rgba(op.color, op.alpha))
    base.alpha_composite(layer)


def _draw_line_segments(draw: ImageDraw.ImageDraw, op: _LineOp, color: _RGBA) -> None:
    if not op.dashed:
        draw.line([op.p0, op.p1], fill=color, width=op.linewidth_px)
        return
    x0, y0 = op.p0
    x1, y1 = op.p1
    length = math.hypot(x1 - x0, y1 - y0)
    if length == 0:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    step = op.dash_px + op.gap_px
    pos = 0.0
    while pos < length:
        end = min(pos + op.dash_px, length)
        draw.line(
            [(x0 + ux * pos, y0 + uy * pos), (x0 + ux * end, y0 + uy * end)],
            fill=color, width=op.linewidth_px,
        )
        pos += step


def _paint_text(base: Image.Image, draw: ImageDraw.ImageDraw, op: _TextOp) -> None:
    font = _font(op.bold, op.size_px)
    color = _rgba(op.color, 1.0)
    if op.rotation == 0.0:
        anchor = _ANCHOR_H[op.ha] + _ANCHOR_V[op.va]
        draw.text(op.pos, op.text, font=font, fill=color, anchor=anchor)
        return
    _paint_rotated_text(base, op, font, color)


def _paint_rotated_text(base: Image.Image, op: _TextOp,
                          font: ImageFont.FreeTypeFont, color: _RGBA) -> None:
    """Render unrotated onto a padded transparent layer at the (ha, va) anchor
    point, then rotate around the layer's own center. ``Image.rotate(...,
    expand=True)`` keeps that center fixed at the post-rotation image's
    center, so rotating the anchor's offset from center by the same angle
    gives its position in the rotated layer — from there we know exactly
    where to paste it so the anchor lands on ``op.pos``, matching
    matplotlib's ``rotation_mode="anchor"``.
    """
    anchor = _ANCHOR_H[op.ha] + _ANCHOR_V[op.va]
    pad = int(font.size)
    text_w = max(1, math.ceil(font.getlength(op.text)))
    text_h = pad * 2
    layer_w, layer_h = text_w + 2 * pad, text_h + 2 * pad
    layer = Image.new("RGBA", (layer_w, layer_h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((pad, pad), op.text, font=font, fill=color, anchor=anchor)

    rotated = layer.rotate(op.rotation, resample=Image.Resampling.BICUBIC, expand=True)

    dx, dy = pad - layer_w / 2, pad - layer_h / 2
    theta = math.radians(op.rotation)
    rdx = dx * math.cos(theta) - dy * math.sin(theta)
    rdy = dx * math.sin(theta) + dy * math.cos(theta)
    anchor_x = rotated.width / 2 + rdx
    anchor_y = rotated.height / 2 + rdy

    paste_x = round(op.pos[0] - anchor_x)
    paste_y = round(op.pos[1] - anchor_y)
    base.paste(rotated, (paste_x, paste_y), rotated)
