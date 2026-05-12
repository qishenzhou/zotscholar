#!/usr/bin/env python3
"""
Generate ZotScholar extension icons (16, 48, 128 px).

Design: Modern iOS style
- Diagonal gradient background matching popup header (#1a1a6e → #2d5be3)
- iOS squircle corner radius (~22% of size)
- White "Z → S" symbol, no hard color split
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os, math

# ── Colours ──────────────────────────────────────────────────────────────────
C1  = np.array([26,  26, 110], dtype=float)   # #1a1a6e  (popup header top)
C2  = np.array([45,  91, 227], dtype=float)   # #2d5be3  (bright indigo low)
WHITE = (255, 255, 255, 255)
WHITE_DIM = (255, 255, 255, 180)

FONT_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_BOLD  = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
OUT_DIR    = os.path.dirname(os.path.abspath(__file__))

# ── Gradient background ───────────────────────────────────────────────────────
def make_gradient(size):
    """135° diagonal gradient from C1 (top-left) to C2 (bottom-right)."""
    x = np.linspace(0, 1, size)
    y = np.linspace(0, 1, size)
    xx, yy = np.meshgrid(x, y)
    t = (xx + yy) / 2                              # 0 at top-left, 1 at bottom-right
    # Add slight radial darkening at edges for depth
    cx, cy = 0.5, 0.5
    dist = np.sqrt((xx - cx)**2 + (yy - cy)**2) / 0.7
    t = np.clip(t + dist * 0.08, 0, 1)
    rgb = (C1[None, None, :] * (1 - t[:, :, None]) +
           C2[None, None, :] *       t[:, :, None])
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB").convert("RGBA")
    return img

# ── Squircle mask ─────────────────────────────────────────────────────────────
def squircle_mask(size, radius_frac=0.2237):
    """Approximate iOS squircle as a rounded rectangle with iOS corner radius."""
    r = max(3, round(size * radius_frac))
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=r, fill=255)
    return mask

# ── Draw symbol ───────────────────────────────────────────────────────────────
def draw_symbol_large(img, size):
    """128 / 48 px: bold 'Z → S' in white."""
    draw = ImageDraw.Draw(img)

    fs  = round(size * 0.42)       # letter font size
    pad = round(size * 0.10)       # side padding

    try:
        fnt = ImageFont.truetype(FONT_BLACK, fs)
    except Exception:
        fnt = ImageFont.load_default()

    # ── Measure Z and S ──────────────────────────────────────────────────────
    bz = draw.textbbox((0, 0), "Z", font=fnt)
    bs = draw.textbbox((0, 0), "S", font=fnt)
    wz = bz[2] - bz[0]
    ws = bs[2] - bs[0]
    letter_h = bz[3] - bz[1]

    cy = size // 2                 # vertical centre

    # Place Z at left, S at right, arrow fills the gap
    zx = pad - bz[0]
    zy = cy - letter_h // 2 - bz[1]

    sx = size - pad - ws - bs[0]
    sy = cy - letter_h // 2 - bs[1]

    draw.text((zx, zy), "Z", font=fnt, fill=WHITE)
    draw.text((sx, sy), "S", font=fnt, fill=WHITE)

    # ── Arrow between Z and S ────────────────────────────────────────────────
    ax_start = pad + wz + round(size * 0.05)
    ax_end   = size - pad - ws - round(size * 0.05)
    ah       = round(size * 0.072)    # arrowhead half-height
    lw       = max(2, round(size * 0.038))

    # Shaft
    shaft_end = ax_end - ah - round(size * 0.01)
    if shaft_end > ax_start:
        draw.line([(ax_start, cy), (shaft_end, cy)], fill=WHITE, width=lw)

    # Arrowhead (filled triangle)
    draw.polygon([
        (ax_end,          cy),
        (ax_end - ah - 2, cy - ah),
        (ax_end - ah - 2, cy + ah),
    ], fill=WHITE)


def draw_symbol_small(img, size):
    """16 px: just a minimal white arrow — no text."""
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    ah = max(2, round(size * 0.22))
    lw = max(1, round(size * 0.14))
    ax1 = round(size * 0.22)
    ax2 = round(size * 0.78)
    draw.line([(ax1, cy), (ax2 - ah, cy)], fill=WHITE, width=lw)
    draw.polygon([
        (ax2,          cy),
        (ax2 - ah,     cy - ah),
        (ax2 - ah,     cy + ah),
    ], fill=WHITE)


# ── Compose icon ─────────────────────────────────────────────────────────────
def make_icon(size):
    bg   = make_gradient(size)
    mask = squircle_mask(size)

    # Apply squircle clip
    bg.putalpha(mask)

    if size >= 32:
        draw_symbol_large(bg, size)
    else:
        draw_symbol_small(bg, size)

    return bg


for sz in [128, 48, 16]:
    icon = make_icon(sz)
    path = os.path.join(OUT_DIR, f"icon{sz}.png")
    icon.save(path, "PNG")
    print(f"Saved {path}  ({sz}×{sz})")
