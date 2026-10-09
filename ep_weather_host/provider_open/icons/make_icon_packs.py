#!/usr/bin/env python3
"""Generates alternative icon packs for the alternate weather providers.

  white/   one flat white silhouette per condition (reads well on a dark taskbar)
  pixel/   16x16 sprites, 8-bit style, drawn from the grids below and scaled 8x with nearest neighbour

Each pack has the same 12 file names as the default pack in the parent folder, so a pack can be swapped in by
pointing the resource script at a different folder. The white pack is written as SVG and rasterized with
ImageMagick (`magick`); the pixel pack is written straight to PNG (no dependencies).

Usage: python make_icon_packs.py
"""
import math
import os
import shutil
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = ["clear-day", "clear-night", "partly-day", "partly-night", "cloudy", "fog",
         "drizzle", "rain", "heavy-rain", "thunder", "snow", "sleet"]


# ---------------------------------------------------------------------------------------------- white pack

W = "#ffffff"


def w_cloud(x, y, s, opacity=1.0):
    return (f'<g transform="translate({x} {y}) scale({s})" fill="{W}" fill-opacity="{opacity}">'
            '<rect x="22" y="66" width="84" height="30" rx="15"/>'
            '<circle cx="50" cy="66" r="19"/><circle cx="76" cy="56" r="25"/><circle cx="94" cy="72" r="15"/>'
            '</g>')


def w_cloudy():
    front = ('<g transform="translate(10 6)">'
             '<rect x="22" y="66" width="84" height="30" rx="15"/>'
             '<circle cx="50" cy="66" r="19"/><circle cx="76" cy="56" r="25"/><circle cx="94" cy="72" r="15"/></g>')
    gap = front.replace('<g ', '<g fill="#000" stroke="#000" stroke-width="12" ')
    return ('<mask id="gap"><rect width="128" height="128" fill="#fff"/>' + gap + '</mask>'
            '<g mask="url(#gap)">' + w_cloud(-8, -8, 0.8) + '</g>' + w_cloud(10, 6, 1.0))


def w_sun(cx, cy, r):
    out = ''
    for i in range(8):
        a = math.radians(i * 45)
        x1, y1 = cx + math.cos(a) * (r + 7), cy + math.sin(a) * (r + 7)
        x2, y2 = cx + math.cos(a) * (r + 17), cy + math.sin(a) * (r + 17)
        out += (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                f'stroke="{W}" stroke-width="7" stroke-linecap="round"/>')
    return out + f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{W}"/>'


def w_moon(cx, cy, r):
    return (f'<mask id="m{cx}{cy}"><rect width="128" height="128" fill="#fff"/>'
            f'<circle cx="{cx + r * 0.55}" cy="{cy - r * 0.35}" r="{r * 0.85}" fill="#000"/></mask>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{W}" mask="url(#m{cx}{cy})"/>')


def w_drops(xs, y, length=14, width=7):
    return ''.join(f'<line x1="{x}" y1="{y}" x2="{x - 5}" y2="{y + length}" stroke="{W}" '
                   f'stroke-width="{width}" stroke-linecap="round"/>' for x in xs)


def w_flake(cx, cy, r=7):
    out = ''
    for i in range(3):
        a = math.radians(i * 60 + 90)
        dx, dy = math.cos(a) * r, math.sin(a) * r
        out += (f'<line x1="{cx - dx:.1f}" y1="{cy - dy:.1f}" x2="{cx + dx:.1f}" y2="{cy + dy:.1f}" '
                f'stroke="{W}" stroke-width="4" stroke-linecap="round"/>')
    return out


def w_bolt(x, y):
    return (f'<polygon transform="translate({x} {y})" points="12,0 0,22 9,22 4,40 22,16 12,16 18,0" '
            f'fill="{W}" stroke="{W}" stroke-width="2" stroke-linejoin="round"/>')


def w_fog(y0):
    return ''.join(f'<line x1="{x1}" y1="{y0 + i * 12}" x2="{x2}" y2="{y0 + i * 12}" stroke="{W}" '
                   'stroke-width="7" stroke-linecap="round"/>'
                   for i, (x1, x2) in enumerate([(26, 102), (36, 112), (26, 92)]))


WHITE = {
    "clear-day": w_sun(64, 64, 26),
    "clear-night": w_moon(60, 64, 34),
    "partly-day": w_sun(48, 48, 20) + w_cloud(10, 14, 0.95),
    "partly-night": w_moon(46, 46, 24) + w_cloud(10, 14, 0.95),
    "cloudy": w_cloudy(),
    "fog": w_cloud(4, -14, 0.95) + w_fog(88),
    "drizzle": w_cloud(4, -14, 0.95) + w_drops([46, 64, 82], 88, 10, 5),
    "rain": w_cloud(4, -14, 0.95) + w_drops([42, 62, 82], 84, 18),
    "heavy-rain": w_cloud(4, -20, 0.95) + w_drops([34, 52, 70, 88], 76, 22, 8),
    "thunder": w_cloud(4, -20, 0.95) + w_bolt(52, 78),
    "snow": w_cloud(4, -14, 0.95) + w_flake(42, 98) + w_flake(64, 108) + w_flake(86, 98),
    "sleet": w_cloud(4, -14, 0.95) + w_drops([40, 80], 84, 14) + w_flake(60, 102),
}


def build_white():
    out = os.path.join(HERE, "white")
    os.makedirs(out, exist_ok=True)
    magick = shutil.which("magick")
    for name, body in WHITE.items():
        path = os.path.join(out, name + ".svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
                    + body + '</svg>\n')
        if magick:
            subprocess.run([magick, "-background", "none", "-density", "384", path, "-resize", "128x128",
                            "PNG32:" + os.path.join(out, name + ".png")], check=True)
    if not magick:
        print("ImageMagick not found: wrote white SVGs only", file=sys.stderr)


# ---------------------------------------------------------------------------------------------- pixel pack

PALETTE = {
    "Y": (255, 214, 64),    # sun
    "O": (255, 150, 20),    # sun rays
    "M": (255, 240, 160),   # moon
    "m": (224, 184, 74),    # moon shade
    "W": (246, 249, 253),   # cloud
    "G": (172, 188, 210),   # cloud shade
    "L": (170, 183, 203),   # storm cloud
    "D": (104, 120, 146),   # storm cloud shade
    "B": (61, 155, 255),    # rain
    "C": (150, 214, 255),   # snow / light rain
    "K": (255, 214, 64),    # lightning
    "F": (170, 184, 204),   # fog
    "S": (255, 255, 255),   # star
}

SUN_FULL = [
    ".......OO.......",
    "..O....OO....O..",
    "...O........O...",
    "......YYYY......",
    ".....YYYYYY.....",
    "....YYYYYYYY....",
    ".OO.YYYYYYYY.OO.",
    ".OO.YYYYYYYY.OO.",
    "....YYYYYYYY....",
    ".....YYYYYY.....",
    "......YYYY......",
    "...O........O...",
    "..O....OO....O..",
    ".......OO.......",
]

def _crescent(n=10):
    rows = []
    for y in range(n):
        row = ""
        for x in range(n):
            px, py = x + 0.5, y + 0.5
            inside = (px - 5) ** 2 + (py - 5) ** 2 <= 4.8 ** 2
            cut = (px - 7.6) ** 2 + (py - 3.4) ** 2 <= 4.2 ** 2
            row += ("m" if px < 3.2 or py > 8 else "M") if inside and not cut else "."
        rows.append(row)
    return rows


MOON = _crescent()


CLOUD = [
    "....WWW.....",
    "..WWWWWWWW..",
    ".WWWWWWWWWWW",
    "WWWWWWWWWWWW",
    "GGGGGGGGGGGG",
    ".GGGGGGGGGG.",
]
STORM = [r.replace("W", "L").replace("G", "D") for r in CLOUD]

BOLT = [
    "..KK.",
    ".KK..",
    "KKKK.",
    "..KK.",
    ".KK..",
    ".K...",
]


def canvas():
    return [["."] * 16 for _ in range(16)]


def put(grid, sprite, x, y):
    for j, row in enumerate(sprite):
        for i, ch in enumerate(row):
            if ch != "." and 0 <= y + j < 16 and 0 <= x + i < 16:
                grid[y + j][x + i] = ch


def dots(grid, pts, ch, ox=0, oy=0):
    for x, y in pts:
        if 0 <= oy + y < 16 and 0 <= ox + x < 16:
            grid[oy + y][ox + x] = ch


def centered(grid):
    """Shift the drawing so its bounding box is centred in the 16x16 cell."""
    cells = [(x, y) for y in range(16) for x in range(16) if grid[y][x] != "."]
    x0, x1 = min(c[0] for c in cells), max(c[0] for c in cells)
    y0, y1 = min(c[1] for c in cells), max(c[1] for c in cells)
    dx, dy = (15 - (x1 - x0)) // 2 - x0, (15 - (y1 - y0)) // 2 - y0
    out = canvas()
    for x, y in cells:
        out[y + dy][x + dx] = grid[y][x]
    return out


def px_clear_day():
    g = canvas()
    put(g, SUN_FULL, 0, 1)
    return g


def px_clear_night():
    g = canvas()
    put(g, MOON, 2, 3)
    dots(g, [(11, 4), (13, 8), (10, 12)], "S")
    return g


def sun_small(g, ox, oy):
    put(g, [".YYYY.", "YYYYYY", "YYYYYY", "YYYYYY", "YYYYYY", ".YYYY."], ox, oy)
    dots(g, [(2, -2), (3, -2), (-1, -1), (6, -1), (-2, 2), (-2, 3), (7, 2), (7, 3)], "O", ox, oy)


def px_partly_day():
    g = canvas()
    sun_small(g, 1, 3)
    put(g, CLOUD, 4, 7)
    return g


def px_partly_night():
    g = canvas()
    put(g, MOON, 1, 2)
    dots(g, [(11, 3)], "S")
    put(g, CLOUD, 4, 7)
    return g


def px_cloudy():
    g = canvas()
    put(g, STORM, 0, 3)
    put(g, CLOUD, 4, 6)
    return g


def px_fog():
    g = canvas()
    put(g, CLOUD[:5], 2, 2)
    for i, (x, w) in enumerate([(2, 10), (4, 10), (2, 8)]):
        for k in range(w):
            g[9 + i * 2][x + k] = "F"
    return g


def px_drizzle():
    g = canvas()
    put(g, CLOUD, 2, 2)
    dots(g, [(2, 7), (6, 7), (10, 7), (4, 9), (8, 9)], "C", 2, 2)
    return g


def px_rain():
    g = canvas()
    put(g, STORM, 2, 2)
    dots(g, [(2, 7), (1, 8), (6, 7), (5, 8), (10, 7), (9, 8), (4, 10), (3, 11), (8, 10), (7, 11)], "B", 2, 2)
    return g


def px_heavy_rain():
    g = canvas()
    put(g, STORM, 2, 1)
    dots(g, [(2, 7), (1, 8), (1, 9), (1, 10), (5, 7), (4, 8), (4, 9), (4, 10),
             (8, 7), (7, 8), (7, 9), (7, 10), (11, 7), (10, 8), (10, 9), (10, 10)], "B", 2, 1)
    return g


def px_thunder():
    g = canvas()
    put(g, STORM, 2, 1)
    put(g, BOLT, 6, 8)
    dots(g, [(1, 7), (0, 8), (11, 7), (10, 8)], "B", 2, 1)
    return g


def px_snow():
    g = canvas()
    put(g, CLOUD, 2, 2)
    dots(g, [(2, 7), (6, 7), (10, 7), (4, 9), (8, 9), (2, 11), (6, 11), (10, 11)], "C", 2, 2)
    return g


def px_sleet():
    g = canvas()
    put(g, STORM, 2, 2)
    dots(g, [(2, 7), (1, 8), (9, 7), (8, 8)], "B", 2, 2)
    dots(g, [(5, 8), (6, 9), (11, 9), (3, 10)], "C", 2, 2)
    return g


PIXEL = {
    "clear-day": px_clear_day, "clear-night": px_clear_night, "partly-day": px_partly_day,
    "partly-night": px_partly_night, "cloudy": px_cloudy, "fog": px_fog, "drizzle": px_drizzle,
    "rain": px_rain, "heavy-rain": px_heavy_rain, "thunder": px_thunder, "snow": px_snow, "sleet": px_sleet,
}


def write_png(path, rgba_rows):
    h, w = len(rgba_rows), len(rgba_rows[0]) // 4
    raw = b"".join(b"\x00" + bytes(row) for row in rgba_rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def build_pixel(scale=8):
    out = os.path.join(HERE, "pixel")
    os.makedirs(out, exist_ok=True)
    for name, fn in PIXEL.items():
        grid = centered(fn())
        for row in grid:
            assert len(row) == 16 and all(c == "." or c in PALETTE for c in row), (name, row)
        rows = []
        for row in grid:
            line = bytearray()
            for ch in row:
                px = bytes(PALETTE[ch]) + b"\xff" if ch != "." else b"\x00\x00\x00\x00"
                line += px * scale
            rows.extend([bytes(line)] * scale)
        write_png(os.path.join(out, name + ".png"), rows)


def main():
    assert sorted(WHITE) == sorted(NAMES) == sorted(PIXEL)
    build_white()
    build_pixel()
    print(f"wrote {len(NAMES)} icons each to white/ and pixel/")


if __name__ == "__main__":
    main()
