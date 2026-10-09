#!/usr/bin/env python3
"""Generates the condition icons used by the alternate weather providers.

Writes one 128x128 SVG per condition next to this script, then rasterizes each to PNG with
ImageMagick (`magick`). The PNGs are what get compiled into ep_weather_host.exe as RCDATA
resources (see ep_weather_host.rc); edit the shapes here or drop in your own PNGs with the same names.

Usage: python make_icons.py        (needs ImageMagick on PATH for the PNG step)
"""
import math
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

DEFS = """<defs>
<linearGradient id="sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ffab00"/></linearGradient>
<linearGradient id="moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c9"/><stop offset="1" stop-color="#e8c766"/></linearGradient>
<linearGradient id="cloud" gradientUnits="userSpaceOnUse" x1="0" y1="38" x2="0" y2="96"><stop offset="0" stop-color="#f6f9fd"/><stop offset="1" stop-color="#bccadc"/></linearGradient>
<linearGradient id="dark" gradientUnits="userSpaceOnUse" x1="0" y1="38" x2="0" y2="96"><stop offset="0" stop-color="#a9b6c9"/><stop offset="1" stop-color="#687891"/></linearGradient>
</defs>"""


def svg(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
            + DEFS + body + '</svg>\n')


def cloud(x, y, s, grad="cloud"):
    # Cloud silhouette in a 128-unit box (bottom edge at y=96), moved/scaled by (x, y, s).
    return (f'<g transform="translate({x} {y}) scale({s})" fill="url(#{grad})">'
            '<rect x="22" y="66" width="84" height="30" rx="15"/>'
            '<circle cx="50" cy="66" r="19"/><circle cx="76" cy="56" r="25"/><circle cx="94" cy="72" r="15"/>'
            '</g>')


def sun(cx, cy, r, rays=True):
    out = ''
    if rays:
        for i in range(8):
            a = math.radians(i * 45)
            x1, y1 = cx + math.cos(a) * (r + 7), cy + math.sin(a) * (r + 7)
            x2, y2 = cx + math.cos(a) * (r + 17), cy + math.sin(a) * (r + 17)
            out += (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                    'stroke="#ffc233" stroke-width="7" stroke-linecap="round"/>')
    return out + f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#sun)"/>'


def moon(cx, cy, r):
    # Crescent = full disc with an offset disc cut out via mask.
    return (f'<mask id="m{cx}{cy}"><rect width="128" height="128" fill="#fff"/>'
            f'<circle cx="{cx + r * 0.55}" cy="{cy - r * 0.35}" r="{r * 0.85}" fill="#000"/></mask>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#moon)" mask="url(#m{cx}{cy})"/>')


def drops(xs, y, length=14, color="#3d9bff", width=7):
    return ''.join(
        f'<line x1="{x}" y1="{y}" x2="{x - 5}" y2="{y + length}" stroke="{color}" '
        f'stroke-width="{width}" stroke-linecap="round"/>' for x in xs)


def flake(cx, cy, r=7, color="#6fb7ff"):
    out = ''
    for i in range(3):
        a = math.radians(i * 60 + 90)
        dx, dy = math.cos(a) * r, math.sin(a) * r
        out += (f'<line x1="{cx - dx:.1f}" y1="{cy - dy:.1f}" x2="{cx + dx:.1f}" y2="{cy + dy:.1f}" '
                f'stroke="{color}" stroke-width="4" stroke-linecap="round"/>')
    return out


def bolt(x, y):
    return (f'<polygon transform="translate({x} {y})" points="12,0 0,22 9,22 4,40 22,16 12,16 18,0" '
            'fill="#ffd23f" stroke="#e5a400" stroke-width="2" stroke-linejoin="round"/>')


def fog_lines(y0):
    return ''.join(
        f'<line x1="{x1}" y1="{y0 + i * 12}" x2="{x2}" y2="{y0 + i * 12}" stroke="#aab8cc" '
        'stroke-width="7" stroke-linecap="round"/>' for i, (x1, x2) in enumerate([(26, 102), (36, 112), (26, 92)]))


ICONS = {
    "clear-day": sun(64, 64, 26),
    "clear-night": moon(60, 64, 34),
    "partly-day": sun(48, 48, 20) + cloud(10, 14, 0.95),
    "partly-night": moon(46, 46, 24) + cloud(10, 14, 0.95),
    "cloudy": cloud(-8, -8, 0.8, "dark") + cloud(10, 6, 1.0),
    "fog": cloud(4, -14, 0.95) + fog_lines(88),
    "drizzle": cloud(4, -14, 0.95) + drops([46, 64, 82], 88, 10, width=5),
    "rain": cloud(4, -14, 0.95, "dark") + drops([42, 62, 82], 84, 18),
    "heavy-rain": cloud(4, -20, 0.95, "dark") + drops([34, 52, 70, 88], 76, 22, width=8),
    "thunder": cloud(4, -20, 0.95, "dark") + bolt(52, 78) + drops([36, 96], 84, 14),
    "snow": cloud(4, -14, 0.95) + flake(42, 98) + flake(64, 108) + flake(86, 98),
    "sleet": cloud(4, -14, 0.95, "dark") + drops([40, 80], 84, 14) + flake(60, 102),
}


def main():
    magick = shutil.which("magick")
    for name, body in ICONS.items():
        path = os.path.join(HERE, name + ".svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg(body))
        if magick:
            subprocess.run([magick, "-background", "none", "-density", "384", path,
                            "-resize", "128x128", "PNG32:" + os.path.join(HERE, name + ".png")], check=True)
    if not magick:
        print("ImageMagick not found: wrote SVGs only", file=sys.stderr)
    print(f"wrote {len(ICONS)} icons")


if __name__ == "__main__":
    main()
