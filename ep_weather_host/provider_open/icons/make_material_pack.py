#!/usr/bin/env python3
"""Builds the "material" and "material-color" icon packs from Google's Material Symbols (Apache-2.0, see
material/NOTICE.md).

The filled glyphs in material/src/ come from the @material-symbols/svg-400 package (v0.48.0). Material Symbols are
single-colour glyphs, so:
  material/        every glyph in white
  material-color/  the same shapes with colour added by this script: sun and moon in yellow, clouds in a light or
                   dark grey gradient, rain in blue, lightning in yellow. Glyphs that draw the cloud and the
                   precipitation as one path are split at a fixed height and each half is coloured separately.
Material has no glyph for "cloud with light rain" or "cloud with heavy rain", so those two are composed from the
plain cloud and the rain-streak glyphs.

Usage: python make_material_pack.py     (needs ImageMagick `magick` for the PNG step)
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "material", "src")
CONDITIONS = ["clear-day", "clear-night", "partly-day", "partly-night", "cloudy", "fog",
              "drizzle", "rain", "heavy-rain", "thunder", "snow", "sleet"]


def path_d(name):
    with open(os.path.join(SRC, name + ".svg"), encoding="utf-8") as f:
        return re.search(r'<path d="([^"]+)"', f.read()).group(1)


def place(cx, cy, scale, gcx=480, gcy=-480):
    """Transform that scales a glyph about its own centre (gcx, gcy) and puts that centre on (cx, cy)."""
    return f'transform="translate({cx - gcx * scale:.1f} {cy - gcy * scale:.1f}) scale({scale})"'


# ------------------------------------------------------------------------------------------ white pack

def white_icons():
    def g(name, transform=""):
        return f'<path {transform} fill="#ffffff" d="{path_d(name)}"/>'

    return {
        "clear-day": g("sunny"),
        "clear-night": g("bedtime"),
        "partly-day": g("partly_cloudy_day"),
        "partly-night": g("partly_cloudy_night"),
        "cloudy": g("cloud"),
        "fog": g("foggy"),
        "drizzle": g("cloud", place(480, -650, 0.8)) + g("rainy_light", place(480, -215, 0.42, 476)),
        "rain": g("rainy"),
        "heavy-rain": g("cloud", place(480, -660, 0.8)) + g("rainy_heavy", place(480, -215, 0.5, 476)),
        "thunder": g("thunderstorm"),
        "snow": g("weather_snowy"),
        "sleet": g("weather_mix"),
    }


# ------------------------------------------------------------------------------------------ colour pack

DEFS = """<defs>
<linearGradient id="sun" gradientUnits="userSpaceOnUse" x1="0" y1="-900" x2="0" y2="-60"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ffab00"/></linearGradient>
<linearGradient id="moon" gradientUnits="userSpaceOnUse" x1="0" y1="-900" x2="0" y2="-60"><stop offset="0" stop-color="#fff6c9"/><stop offset="1" stop-color="#e8c766"/></linearGradient>
<linearGradient id="cloud" gradientUnits="userSpaceOnUse" x1="0" y1="-880" x2="0" y2="-160"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c8dc"/></linearGradient>
<linearGradient id="dark" gradientUnits="userSpaceOnUse" x1="0" y1="-880" x2="0" y2="-160"><stop offset="0" stop-color="#b4c0d2"/><stop offset="1" stop-color="#6a7a93"/></linearGradient>
<clipPath id="top"><rect x="0" y="-960" width="960" height="650"/></clipPath>
<clipPath id="bottom"><rect x="0" y="-310" width="960" height="310"/></clipPath>
</defs>"""

RAIN = "#3d9bff"
SNOW = "#8cc8ff"
BOLT = "#ffd23f"
FOG = "#aab8cc"


def color_icons():
    def g(name, fill, transform="", clip=""):
        c = f' clip-path="url(#{clip})"' if clip else ""
        return f'<path {transform}{c} fill="{fill}" d="{path_d(name)}"/>'

    def split(name, top_fill, bottom_fill):
        return g(name, top_fill, clip="top") + g(name, bottom_fill, clip="bottom")

    def gap(transform, name="cloud", grow=46):
        # Mask that cuts `name` (plus a margin) out of whatever is drawn behind it.
        return (f'<mask id="gap"><rect x="0" y="-960" width="960" height="960" fill="#fff"/>'
                f'<path {transform} d="{path_d(name)}" fill="#000" stroke="#000" stroke-width="{grow}" '
                'stroke-linejoin="round"/></mask>')

    sun_t, cloud_t = place(340, -625, 0.66), place(560, -400, 0.84)
    cloudy_back, cloudy_front = place(330, -610, 0.68), place(550, -420, 0.86)

    return {
        "clear-day": g("sunny", "url(#sun)"),
        "clear-night": g("bedtime", "url(#moon)"),
        "partly-day": gap(cloud_t) + f'<g mask="url(#gap)">{g("sunny", "url(#sun)", sun_t)}</g>' + g("cloud", "url(#cloud)", cloud_t),
        "partly-night": gap(cloud_t) + f'<g mask="url(#gap)">{g("bedtime", "url(#moon)", sun_t)}</g>' + g("cloud", "url(#cloud)", cloud_t),
        "cloudy": gap(cloudy_front) + f'<g mask="url(#gap)">{g("cloud", "url(#dark)", cloudy_back)}</g>' + g("cloud", "url(#cloud)", cloudy_front),
        "fog": split("foggy", "url(#cloud)", FOG),
        "drizzle": g("cloud", "url(#cloud)", place(480, -650, 0.8)) + g("rainy_light", RAIN, place(480, -215, 0.42, 476)),
        "rain": split("rainy", "url(#dark)", RAIN),
        "heavy-rain": g("cloud", "url(#dark)", place(480, -660, 0.8)) + g("rainy_heavy", RAIN, place(480, -215, 0.5, 476)),
        "thunder": split("thunderstorm", "url(#dark)", BOLT),
        "snow": split("weather_snowy", "url(#cloud)", SNOW),
        "sleet": split("weather_mix", "url(#dark)", SNOW),
    }


# ------------------------------------------------------------------------------------------ output

def write_pack(folder, icons, defs=""):
    out = os.path.join(HERE, folder)
    os.makedirs(out, exist_ok=True)
    magick = shutil.which("magick")
    for name in CONDITIONS:
        svg = os.path.join(out, name + ".svg")
        with open(svg, "w", encoding="utf-8") as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="128" height="128">'
                    + defs + icons[name] + '</svg>\n')
        if magick:
            subprocess.run([magick, "-background", "none", "-density", "768", svg, "-resize", "128x128",
                            "PNG32:" + os.path.join(out, name + ".png")], check=True)
    if not magick:
        print("ImageMagick not found: wrote SVGs only", file=sys.stderr)


def main():
    write_pack("material", white_icons())
    write_pack("material-color", color_icons(), DEFS)
    print(f"wrote {len(CONDITIONS)} icons each to material/ and material-color/")


if __name__ == "__main__":
    main()
