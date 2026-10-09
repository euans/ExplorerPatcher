# Material icon pack

The glyphs in `src/` are from Google's **Material Symbols**
(`@material-symbols/svg-400` 0.48.0, <https://github.com/google/material-design-icons>), licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). They are unmodified copies of the *filled*
variants of: sunny, bedtime, partly_cloudy_day, partly_cloudy_night, cloud, foggy, rainy, thunderstorm,
weather_snowy, weather_mix, rainy_light, rainy_heavy.

The `*.svg` and `*.png` files next to this notice are generated from them by `../make_material_pack.py`
(recolored white; `drizzle` and `heavy-rain` are composed from the `cloud` glyph and the rain-streak glyphs).

Copyright Google LLC.

The sibling folder `material-color/` is built from the same glyphs, with colour added by `make_material_pack.py`;
the glyph shapes are unchanged.
