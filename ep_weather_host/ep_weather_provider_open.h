#ifndef _H_EP_WEATHER_PROVIDER_OPEN_H_
#define _H_EP_WEATHER_PROVIDER_OPEN_H_
#include "ep_weather_host.h"

// Builds the page for the providers that call a web API instead of scraping a site (Open-Meteo, NWS, wttr.in,
// OpenWeatherMap, WeatherAPI.com). The page, its scripts and its icons are compiled into the module as RCDATA
// resources (provider_open\ in the source tree); this injects the current settings (location, language,
// unit, API key for the active provider, icon size) and returns the result for ICoreWebView2::NavigateToString.
//
// The page protocol is documented at the top of provider_open\ui.js. Returns a malloc'ed string that the
// caller must free(), or NULL on failure.
LPWSTR epw_Open_BuildPage(EPWeather* _this);
#endif
