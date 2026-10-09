# Alternate weather providers

The Google provider scrapes `google.com/search`. The providers here call a weather **API** instead:

| Id | Provider | Key | Coverage |
|----|----------|-----|----------|
| 2 | [Open-Meteo](https://open-meteo.com/) | none | worldwide |
| 3 | [National Weather Service](https://www.weather.gov/documentation/services-web-api) | none | US only |
| 4 | [wttr.in](https://wttr.in/) | none | worldwide |
| 5 | [OpenWeatherMap](https://openweathermap.org/api) | **required** | worldwide |
| 6 | [WeatherAPI.com](https://www.weatherapi.com/) | **required** | worldwide |

Ids match `EP_WEATHER_PROVIDER_*` in `../ep_weather.h`. Google stays provider 1 and the default.

## How it works

```
ep_weather_provider_open.c   builds one HTML page from the RCDATA resources below + the current settings
        |  NavigateToString
        v
weather.html + providers.js + ui.js     runs inside the host's WebView2: fetches the API, draws the flyout
        |  ExecuteScript("ep_weather_poll()")  every 500 ms
        v
ep_weather_host.c            "ep_pending" -> poll again, "ep_error:..." -> error page,
                             otherwise the same '#'-separated payload as the Google script
```

* `providers.js` - one adapter per API, all returning the same metric model (documented at the top of the
  file). No DOM access, so it also runs under Node.
* `ui.js` - renders the flyout and produces the taskbar payload. The icon is the PNG for the current condition,
  scaled by a canvas to `iconSize` and encoded as premultiplied BGRA hex, which is what the taskbar copies into
  a DIB section. The protocol is documented at the top of the file.
* `weather.html` - layout and light/dark styling. The host emulates `prefers-color-scheme`, so the page needs
  no theme logic.
* `icons/*.png` - one icon per condition (names = `ICON_KEYS` in `providers.js`). Regenerate with
  `python icons/make_icons.py` (needs ImageMagick), or drop in your own 128x128 RGBA PNGs with the same names.
* Everything above is compiled into the module as `RCDATA` (`../ep_weather_host.rc`), so the install is still
  a single file. The page is rebuilt on every refresh; settings are injected as `window.EP_CFG`.

Configuration problems the user can fix (missing/rejected API key, unknown location, NWS outside the US) are
shown inside the flyout and as the condition text on the taskbar. Network failures use the host's usual error page.

## Settings

Under `HKCU\Software\ExplorerPatcher` (also on the Weather page of the settings):

| Value | Type | Meaning |
|-------|------|---------|
| `WeatherProvider` | DWORD | 1 Google (default), 2-6 as in the table above |
| `WeatherApiKeyOpenWeatherMap` | string | key used when provider 5 is selected |
| `WeatherApiKeyWeatherApi` | string | key used when provider 6 is selected |

Keys are stored in plain text in the user's registry hive, like every other setting. To add a provider that needs
a key, add a row to `WeatherApiKeyValues[]` in `ExplorerPatcher/dllmain.c` and a text entry to the two `settings*.reg` files.

## Adding a provider

1. `ep_weather.h`: new `EP_WEATHER_PROVIDER_*`, bump `EP_WEATHER_NUM_PROVIDERS`.
2. `providers.js`: write an adapter returning the model and register it in `ADAPTERS` and `PROVIDER`
   (add it to `NEEDS_KEY` there, and to `PROVIDER_NAMES` in `ui.js`, if it needs a key).
3. Settings: a combo entry in `settings.reg`/`settings10.reg`, string ids in `EPSettingsResources.h` and the `.rc`.

`test/assets.test.js` fails if the ids, icon names or settings strings drift apart.

## Tests

From this folder, with Node 18+:

```
node --test test/*.test.js      # offline: mocked key-based providers, error classification, condition tables,
                                #          and cross-checks of the C/rc/reg/settings plumbing
node test/live_smoke.js         # hits the real keyless APIs (Open-Meteo, NWS, wttr.in)
node test/build_preview.js 2 "Chicago, IL" F "" dark fixed   # writes test/preview.html: open it in a browser
```

## Known limitations

* Condition text from Open-Meteo and NWS is English only (they return codes / English text). OpenWeatherMap,
  WeatherAPI.com and wttr.in honour the `WeatherLanguage` setting. Flyout labels ("Feels like"...) are English.
* "Current location" is IP based (geojs.io, then ipwho.is) unless precise geolocation is enabled in the host.
* The Microsoft/Google icon pack setting only applies to the Google provider.
* wttr.in is a community service without an SLA; OpenWeatherMap keys can take a couple of hours to activate.
