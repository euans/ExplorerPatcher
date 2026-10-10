/*
 * Weather data adapters for the ExplorerPatcher weather providers.
 *
 * Runs inside the WebView2 page hosted by ep_weather_host (see weather.html / ui.js) and also under
 * Node for testing (see test/). No DOM access in here: every adapter turns one upstream API into the
 * same normalized model, always in metric units:
 *
 *   {
 *     place, tempC, feelsC, text, icon, humidity, windKph, windDir, pressureHpa, precipMm,
 *     nowLocal,                       // location-local "wall clock" time, see note below
 *     hourly: [{ t, tempC, icon, pop }],
 *     daily:  [{ t, hiC, loC, icon, pop, text }],
 *     source: { name, url }
 *   }
 *
 * Times (nowLocal, t) are "pseudo-UTC" milliseconds: the wall-clock time AT THE LOCATION, encoded as if it
 * were UTC. Format them with timeZone:'UTC' and they read correctly no matter where the machine is.
 *
 * Failures are thrown as EPWError with kind: 'key' (missing/invalid/exhausted API key, shown in the
 * flyout), 'location' (nothing found), 'unsupported' (e.g. NWS outside the US) or 'network'.
 */
(function (root) {
    'use strict';

    const PROVIDER = { OPENMETEO: 2, NWS: 3, WTTR: 4, OWM: 5, WEATHERAPI: 6 };
    const NEEDS_KEY = { 5: true, 6: true };
    const ICON_KEYS = ['clear-day', 'clear-night', 'partly-day', 'partly-night', 'cloudy', 'fog',
        'drizzle', 'rain', 'heavy-rain', 'thunder', 'snow', 'sleet'];
    const TIMEOUT_MS = 20000;

    class EPWError extends Error {
        constructor(kind, message) {
            super(message);
            this.name = 'EPWError';
            this.kind = kind;
        }
    }

    // ---------------------------------------------------------------- helpers

    async function getJSON(url, init) {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
        let res;
        try {
            res = await fetch(url, Object.assign({ cache: 'no-store', signal: ctl && ctl.signal }, init));
        } catch (e) {
            throw new EPWError('network', 'Request failed: ' + (e && e.message || e));
        } finally {
            if (timer) clearTimeout(timer);
        }
        let body = null;
        try { body = await res.json(); } catch (e) { /* not JSON */ }
        if (!res.ok) {
            const err = new EPWError(res.status === 401 || res.status === 403 ? 'key'
                : res.status === 404 ? 'location' : 'network', 'HTTP ' + res.status + ' from ' + hostOf(url));
            err.status = res.status;
            err.body = body;
            throw err;
        }
        if (body === null) throw new EPWError('network', 'Unreadable response from ' + hostOf(url));
        return body;
    }

    function hostOf(url) { try { return new URL(url).host; } catch (e) { return url; } }
    const enc = encodeURIComponent;
    const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;
    const fToC = (f) => (f - 32) * 5 / 9;
    const pad2 = (n) => (n < 10 ? '0' : '') + n;

    // "2026-10-09T14:00", "2026-10-09 14:00", "2026-10-9 2:30" or offset ISO strings -> pseudo-UTC ms.
    function wallClock(str) {
        const m = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(str || '');
        if (!m) return null;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    }

    function dayKey(t) { return new Date(t).toISOString().slice(0, 10); }

    // "06:50 AM" -> minutes since midnight
    function clock12(s) {
        const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s || '');
        if (!m) return null;
        let h = +m[1] % 12;
        if (m[3] && m[3].toUpperCase() === 'PM') h += 12;
        if (!m[3]) h = +m[1];
        return h * 60 + +m[2];
    }

    // Current wall-clock time in an IANA zone as pseudo-UTC ms, or null when the zone is unknown.
    function zoneNow(tz) {
        if (!tz) return null;
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }).formatToParts(new Date());
            const g = (type) => +parts.find(x => x.type === type).value;
            return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
        } catch (e) { return null; }
    }

    function minutesOfDay(t) { const d = new Date(t); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

    function dayIcon(icon, isDay) {
        if (icon === 'clear-day' || icon === 'clear-night') return isDay ? 'clear-day' : 'clear-night';
        if (icon === 'partly-day' || icon === 'partly-night') return isDay ? 'partly-day' : 'partly-night';
        return icon;
    }

    // Keep upcoming entries: from the current hour on, at most `max`.
    function upcoming(list, nowLocal, max) {
        const from = nowLocal - 45 * 60000;
        return list.filter(h => h.t >= from).slice(0, max);
    }

    // ---------------------------------------------------------------- condition mapping

    // WeatherAPI.com codes are WorldWeatherOnline codes + 887, so one table serves wttr.in and WeatherAPI.
    const WWO = {};
    (function () {
        const put = (icon, text, codes) => codes.forEach(c => { WWO[c] = [icon, text[c] || text.def]; });
        put('clear-day', { def: 'Clear' }, [113]);
        put('partly-day', { def: 'Partly cloudy' }, [116]);
        put('cloudy', { 119: 'Cloudy', 122: 'Overcast', def: 'Cloudy' }, [119, 122]);
        put('fog', { 143: 'Mist', 248: 'Fog', 260: 'Freezing fog', def: 'Fog' }, [143, 248, 260]);
        put('drizzle', { 263: 'Patchy light drizzle', 266: 'Light drizzle', def: 'Drizzle' }, [263, 266]);
        put('rain', {
            176: 'Patchy rain nearby', 293: 'Patchy light rain', 296: 'Light rain', 299: 'Rain at times',
            302: 'Moderate rain', 353: 'Light rain shower', 356: 'Rain shower', def: 'Rain'
        }, [176, 293, 296, 299, 302, 353, 356]);
        put('heavy-rain', { 305: 'Heavy rain at times', 308: 'Heavy rain', 359: 'Torrential rain', def: 'Heavy rain' }, [305, 308, 359]);
        put('sleet', {
            182: 'Patchy sleet', 185: 'Patchy freezing drizzle', 281: 'Freezing drizzle', 284: 'Heavy freezing drizzle',
            311: 'Light freezing rain', 314: 'Freezing rain', 317: 'Light sleet', 320: 'Sleet', 350: 'Ice pellets',
            362: 'Light sleet showers', 365: 'Sleet showers', 374: 'Light ice pellet showers', 377: 'Ice pellet showers', def: 'Sleet'
        }, [182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377]);
        put('snow', {
            179: 'Patchy snow', 227: 'Blowing snow', 230: 'Blizzard', 323: 'Patchy light snow', 326: 'Light snow',
            329: 'Patchy snow', 332: 'Snow', 335: 'Patchy heavy snow', 338: 'Heavy snow', 368: 'Light snow showers',
            371: 'Snow showers', def: 'Snow'
        }, [179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371]);
        put('thunder', {
            200: 'Thundery outbreaks', 386: 'Light rain with thunder', 389: 'Rain with thunder',
            392: 'Light snow with thunder', 395: 'Snow with thunder', def: 'Thunderstorm'
        }, [200, 386, 389, 392, 395]);
    })();

    function fromWWO(code, isDay, fallbackText) {
        const hit = WWO[code];
        if (!hit) return { icon: 'cloudy', text: fallbackText || 'Unknown' };
        let text = hit[1];
        if (code === 113 && !isDay) text = 'Clear';
        if (code === 113 && isDay) text = 'Sunny';
        return { icon: dayIcon(hit[0], isDay), text: fallbackText || text };
    }

    const WMO_TEXT = {
        0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
        51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
        61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
        71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light rain showers',
        81: 'Rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail'
    };

    function fromWMO(code, isDay) {
        let icon;
        if (code === 0 || code === 1) icon = 'clear-day';
        else if (code === 2) icon = 'partly-day';
        else if (code === 3) icon = 'cloudy';
        else if (code === 45 || code === 48) icon = 'fog';
        else if (code >= 51 && code <= 55) icon = 'drizzle';
        else if (code === 56 || code === 57 || code === 66 || code === 67) icon = 'sleet';
        else if (code === 61 || code === 63 || code === 80 || code === 81) icon = 'rain';
        else if (code === 65 || code === 82) icon = 'heavy-rain';
        else if ((code >= 71 && code <= 77) || code === 85 || code === 86) icon = 'snow';
        else if (code >= 95) icon = 'thunder';
        else icon = 'cloudy';
        let text = WMO_TEXT[code] || 'Unknown';
        if (code === 0 && isDay) text = 'Sunny';
        return { icon: dayIcon(icon, isDay), text };
    }

    function fromOWM(id, iconCode) {
        const isDay = !/n$/.test(iconCode || '');
        let icon;
        if (id >= 200 && id < 300) icon = 'thunder';
        else if (id >= 300 && id < 400) icon = 'drizzle';
        else if (id === 511) icon = 'sleet';
        else if (id === 502 || id === 503 || id === 504 || id === 522 || id === 531) icon = 'heavy-rain';
        else if (id >= 500 && id < 600) icon = 'rain';
        else if (id >= 611 && id <= 616) icon = 'sleet';
        else if (id >= 600 && id < 700) icon = 'snow';
        else if (id >= 700 && id < 800) icon = 'fog';
        else if (id === 800) icon = 'clear-day';
        else if (id === 801 || id === 802) icon = 'partly-day';
        else icon = 'cloudy';
        return dayIcon(icon, isDay);
    }

    // Free-text conditions (National Weather Service "shortForecast").
    function fromText(text, isDay) {
        const t = (text || '').toLowerCase();
        let icon;
        if (/thunder|t-storm/.test(t)) icon = 'thunder';
        else if (/sleet|freezing|wintry|ice pellet/.test(t)) icon = 'sleet';
        else if (/snow|flurr|blizzard/.test(t)) icon = 'snow';
        else if (/heavy rain|torrential|downpour/.test(t)) icon = 'heavy-rain';
        else if (/drizzle/.test(t)) icon = 'drizzle';
        else if (/rain|shower/.test(t)) icon = 'rain';
        else if (/fog|mist|haze|smoke|dust/.test(t)) icon = 'fog';
        else if (/mostly cloudy|overcast/.test(t)) icon = 'cloudy';
        else if (/partly|few clouds|scattered clouds|broken clouds/.test(t)) icon = 'partly-day';
        else if (/cloudy/.test(t)) icon = 'cloudy';
        else if (/sunny|clear|fair/.test(t)) icon = 'clear-day';
        else icon = 'cloudy';
        return dayIcon(icon, isDay);
    }

    // ---------------------------------------------------------------- location

    // Splits "Chicago, IL" into a city query plus a hint to disambiguate the geocoder results.
    async function geocode(term, lang) {
        const comma = term.indexOf(',');
        const city = (comma > 0 ? term.slice(0, comma) : term).trim();
        const hint = (comma > 0 ? term.slice(comma + 1) : '').trim().toLowerCase();
        const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + enc(city) + '&count=' + (hint ? 20 : 1) +
            '&language=' + enc(lang || 'en') + '&format=json';
        const res = await getJSON(url);
        let hits = res.results || [];
        if (hint) {
            const match = hits.filter(r => [r.admin1, r.admin2, r.country, r.country_code]
                .some(f => f && (f.toLowerCase() === hint || f.toLowerCase().startsWith(hint))));
            if (match.length) hits = match;
        }
        if (hits.length) {
            const r = hits[0];
            return {
                lat: r.latitude, lon: r.longitude, countryCode: r.country_code, tz: r.timezone,
                name: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : r.country].filter(Boolean).join(', ')
            };
        }
        // Postal codes are not in the geocoder; zippopotam.us covers US ZIPs.
        if (/^\d{5}(-\d{4})?$/.test(term.trim())) {
            const z = await getJSON('https://api.zippopotam.us/us/' + enc(term.trim().slice(0, 5)));
            const p = z.places && z.places[0];
            if (p) {
                return {
                    lat: +p.latitude, lon: +p.longitude, countryCode: 'US', tz: null,
                    name: p['place name'] + ', ' + p['state abbreviation']
                };
            }
        }
        throw new EPWError('location', 'No location found for "' + term + '"');
    }

    function browserPosition(timeoutMs) {
        return new Promise((resolve, reject) => {
            if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('no geolocation'));
            navigator.geolocation.getCurrentPosition(
                p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), reject,
                { timeout: timeoutMs, maximumAge: 600000 });
        });
    }

    // "Current location": precise geolocation when the user allowed it, otherwise IP based.
    async function locateCurrent(cfg) {
        let ip = null;
        const lookups = [
            async () => {
                const r = await getJSON('https://get.geojs.io/v1/ip/geo.json');
                return { lat: +r.latitude, lon: +r.longitude, countryCode: r.country_code, tz: r.timezone, name: [r.city, r.region].filter(Boolean).join(', ') };
            },
            async () => {
                const r = await getJSON('https://ipwho.is/');
                if (!r.success) throw new Error('ipwho.is: ' + r.message);
                return { lat: +r.latitude, lon: +r.longitude, countryCode: r.country_code, tz: r.timezone && r.timezone.id, name: [r.city, r.region].filter(Boolean).join(', ') };
            }
        ];
        for (const look of lookups) {
            try { ip = await look(); if (isFinite(ip.lat) && isFinite(ip.lon)) break; ip = null; } catch (e) { ip = null; }
        }
        if (cfg.geo) {
            try {
                const p = await browserPosition(6000);
                return { lat: p.lat, lon: p.lon, countryCode: ip && ip.countryCode, tz: ip && ip.tz, name: ip && ip.name || '' };
            } catch (e) { /* fall through to IP */ }
        }
        if (!ip) throw new EPWError('location', 'Could not determine the current location');
        return ip;
    }

    async function resolveLocation(cfg) {
        return cfg.term ? geocode(cfg.term, cfg.lang) : locateCurrent(cfg);
    }

    function requireKey(cfg, name) {
        if (!cfg.apiKey) throw new EPWError('key', name + ' needs an API key');
    }

    // ---------------------------------------------------------------- Open-Meteo

    async function openMeteo(cfg) {
        const loc = await resolveLocation(cfg);
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
            '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m' +
            '&hourly=temperature_2m,precipitation_probability,weather_code,is_day' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
            '&timezone=auto&forecast_days=7&wind_speed_unit=kmh';
        const r = await getJSON(url);
        const c = r.current;
        const cond = fromWMO(c.weather_code, c.is_day);
        const hourly = r.hourly.time.map((iso, i) => ({
            t: wallClock(iso), tempC: r.hourly.temperature_2m[i], pop: num(r.hourly.precipitation_probability[i]),
            icon: fromWMO(r.hourly.weather_code[i], r.hourly.is_day[i]).icon
        }));
        const nowLocal = wallClock(c.time);
        return {
            place: loc.name, tempC: c.temperature_2m, feelsC: c.apparent_temperature, text: cond.text, icon: cond.icon,
            humidity: c.relative_humidity_2m, windKph: c.wind_speed_10m, windDir: c.wind_direction_10m,
            pressureHpa: c.pressure_msl, precipMm: c.precipitation, nowLocal,
            hourly: upcoming(hourly, nowLocal, 24),
            daily: r.daily.time.map((iso, i) => {
                const d = fromWMO(r.daily.weather_code[i], 1);
                return {
                    t: wallClock(iso), hiC: r.daily.temperature_2m_max[i], loC: r.daily.temperature_2m_min[i],
                    pop: num(r.daily.precipitation_probability_max[i]), icon: d.icon, text: d.text
                };
            }),
            source: { name: 'Open-Meteo', url: 'https://open-meteo.com/' }
        };
    }

    // ---------------------------------------------------------------- National Weather Service

    async function nws(cfg) {
        const loc = await resolveLocation(cfg);
        if (loc.countryCode && loc.countryCode !== 'US') {
            throw new EPWError('unsupported', 'The National Weather Service only covers US locations');
        }
        const init = { headers: { Accept: 'application/geo+json' } };
        let points;
        try {
            points = await getJSON('https://api.weather.gov/points/' + loc.lat.toFixed(4) + ',' + loc.lon.toFixed(4), init);
        } catch (e) {
            if (e.status === 404) throw new EPWError('unsupported', 'The National Weather Service has no data for this location');
            throw e;
        }
        const p = points.properties;
        const rel = p.relativeLocation && p.relativeLocation.properties;
        const [fc, hr, st] = await Promise.all([
            getJSON(p.forecast, init), getJSON(p.forecastHourly, init), getJSON(p.observationStations, init)
        ]);

        const tempOf = (period) => period.temperatureUnit === 'F' ? fToC(period.temperature) : period.temperature;
        const hrPeriods = hr.properties.periods;
        const hourly = hrPeriods.map(h => ({
            t: wallClock(h.startTime), tempC: tempOf(h), pop: num(h.probabilityOfPrecipitation && h.probabilityOfPrecipitation.value),
            icon: fromText(h.shortForecast, h.isDaytime)
        }));
        const nowLocal = hourly.length ? hourly[0].t : wallClock(new Date().toISOString());
        const isDay = hrPeriods.length ? hrPeriods[0].isDaytime : true;

        // Latest observation from the first nearby station that is actually reporting.
        let obs = null;
        for (const f of (st.features || []).slice(0, 4)) {
            try {
                const o = await getJSON('https://api.weather.gov/stations/' + f.properties.stationIdentifier + '/observations/latest', init);
                if (o.properties && o.properties.temperature && o.properties.temperature.value !== null) { obs = o.properties; break; }
            } catch (e) { /* try next station */ }
        }

        // Daily hi/lo from the hourly series, label and icon from the daytime forecast period.
        const days = new Map();
        hourly.forEach(h => {
            const k = dayKey(h.t);
            const d = days.get(k) || { t: Date.parse(k + 'T00:00Z'), hiC: -Infinity, loC: Infinity, pop: null, icon: null, text: '' };
            d.hiC = Math.max(d.hiC, h.tempC); d.loC = Math.min(d.loC, h.tempC);
            if (h.pop !== null) d.pop = Math.max(d.pop === null ? 0 : d.pop, h.pop);
            days.set(k, d);
        });
        fc.properties.periods.forEach(per => {
            const d = days.get(per.startTime.slice(0, 10));
            if (d && (per.isDaytime || !d.icon)) { d.icon = fromText(per.shortForecast, true); d.text = per.shortForecast; }
        });

        const first = hrPeriods[0] || {};
        const windMatch = /(\d+)/.exec(first.windSpeed || '');
        const cur = obs ? {
            tempC: obs.temperature.value, text: obs.textDescription || first.shortForecast || '',
            humidity: obs.relativeHumidity && obs.relativeHumidity.value,
            windKph: obs.windSpeed && obs.windSpeed.value, windDir: obs.windDirection && obs.windDirection.value,
            pressureHpa: obs.barometricPressure && obs.barometricPressure.value !== null ? obs.barometricPressure.value / 100 : null,
            feelsC: obs.windChill && obs.windChill.value !== null ? obs.windChill.value : (obs.heatIndex && obs.heatIndex.value)
        } : {
            tempC: tempOf(first), text: first.shortForecast || '', humidity: first.relativeHumidity && first.relativeHumidity.value,
            windKph: windMatch ? +windMatch[1] * 1.609 : null, windDir: null, pressureHpa: null, feelsC: null
        };
        const text = (obs && obs.textDescription) || first.shortForecast || '';
        return {
            place: rel ? rel.city + ', ' + rel.state : loc.name, tempC: cur.tempC, feelsC: num(cur.feelsC), text,
            icon: fromText(text, isDay), humidity: num(cur.humidity), windKph: num(cur.windKph), windDir: num(cur.windDir),
            pressureHpa: num(cur.pressureHpa), precipMm: null, nowLocal,
            hourly: upcoming(hourly, nowLocal, 24),
            daily: Array.from(days.values()).filter(d => d.icon).slice(0, 7).map(d => Object.assign(d, { icon: d.icon })),
            source: { name: 'National Weather Service', url: 'https://www.weather.gov/' }
        };
    }

    // ---------------------------------------------------------------- wttr.in

    async function wttr(cfg) {
        // wttr.in's own place matching is fuzzy ("Chicago, IL" can land on a nearby village), so resolve the
        // place with the shared geocoder and query by coordinates. Falls back to wttr's own lookup.
        let loc = null;
        try { loc = await resolveLocation(cfg); } catch (e) { if (e.kind === 'location' && cfg.term) throw e; }
        const query = loc ? loc.lat.toFixed(4) + ',' + loc.lon.toFixed(4) : (cfg.term ? enc(cfg.term) : '');
        const r = await getJSON('https://wttr.in/' + query + '?format=j1&lang=' + enc(cfg.lang || 'en'));
        const cc = r.current_condition && r.current_condition[0];
        if (!cc || !r.weather) throw new EPWError('location', 'wttr.in returned no data');

        const area = r.nearest_area && r.nearest_area[0];
        const val = (a) => a && a[0] && a[0].value;
        const place = loc && loc.name ? loc.name : area ? [val(area.areaName), val(area.region) && val(area.region) !== val(area.areaName) ? val(area.region) : val(area.country)].filter(Boolean).join(', ') : (cfg.term || '');

        // wttr.in's localObsDateTime is not reliably local, so prefer the geocoder's time zone.
        const lo = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(cc.localObsDateTime || '');
        const nowLocal = zoneNow(loc && loc.tz) ||
            (lo ? Date.parse(lo[1] + 'T00:00Z') + clock12(lo[2]) * 60000 : wallClock(new Date().toISOString()));

        const astro = {};
        r.weather.forEach(d => {
            const a = d.astronomy && d.astronomy[0];
            astro[d.date] = a ? { rise: clock12(a.sunrise), set: clock12(a.sunset) } : null;
        });
        const isDayAt = (t) => {
            const a = astro[dayKey(t)];
            if (!a || a.rise === null || a.set === null) return true;
            const m = minutesOfDay(t);
            return m >= a.rise && m < a.set;
        };

        const hourly = [];
        r.weather.forEach(d => d.hourly.forEach(h => {
            const hhmm = String(h.time).padStart(4, '0');
            const t = Date.parse(d.date + 'T00:00Z') + (+hhmm.slice(0, 2) * 60 + +hhmm.slice(2)) * 60000;
            hourly.push({
                t, tempC: +h.tempC, pop: num(h.chanceofrain),
                icon: fromWWO(+h.weatherCode, isDayAt(t)).icon
            });
        }));

        const lang = (cfg.lang || 'en').toLowerCase().slice(0, 2);
        const localized = cc['lang_' + lang] ? val(cc['lang_' + lang]) : null;
        const cond = fromWWO(+cc.weatherCode, isDayAt(nowLocal), localized || val(cc.weatherDesc));
        return {
            place, tempC: +cc.temp_C, feelsC: num(cc.FeelsLikeC), text: cond.text, icon: cond.icon,
            humidity: num(cc.humidity), windKph: num(cc.windspeedKmph), windDir: num(cc.winddirDegree),
            pressureHpa: num(cc.pressure), precipMm: num(cc.precipMM), nowLocal,
            hourly: upcoming(hourly, nowLocal, 12),
            daily: r.weather.map(d => {
                const noon = d.hourly.find(h => String(h.time) === '1200') || d.hourly[Math.floor(d.hourly.length / 2)];
                const w = fromWWO(+noon.weatherCode, true);
                return {
                    t: Date.parse(d.date + 'T00:00Z'), hiC: +d.maxtempC, loC: +d.mintempC,
                    pop: Math.max.apply(null, d.hourly.map(h => +h.chanceofrain || 0)), icon: w.icon,
                    text: (cc['lang_' + lang] && noon['lang_' + lang] && val(noon['lang_' + lang])) || val(noon.weatherDesc) || w.text
                };
            }),
            source: { name: 'wttr.in', url: 'https://wttr.in/' }
        };
    }

    // ---------------------------------------------------------------- OpenWeatherMap

    async function openWeatherMap(cfg) {
        requireKey(cfg, 'OpenWeatherMap');
        const lang = enc((cfg.lang || 'en').toLowerCase());
        const key = '&units=metric&lang=' + lang + '&appid=' + enc(cfg.apiKey);
        let where;
        if (cfg.term) {
            where = /^\d{5}$/.test(cfg.term.trim()) ? 'zip=' + enc(cfg.term.trim() + ',us') : 'q=' + enc(cfg.term);
        } else {
            const loc = await locateCurrent(cfg);
            where = 'lat=' + loc.lat + '&lon=' + loc.lon;
        }
        let cur;
        try {
            cur = await getJSON('https://api.openweathermap.org/data/2.5/weather?' + where + key);
        } catch (e) {
            if (e.status === 401) throw new EPWError('key', 'OpenWeatherMap rejected the API key (new keys can take a couple of hours to activate)');
            if (e.status === 404) throw new EPWError('location', 'OpenWeatherMap could not find "' + cfg.term + '"');
            throw e;
        }
        const fc = await getJSON('https://api.openweathermap.org/data/2.5/forecast?lat=' + cur.coord.lat + '&lon=' + cur.coord.lon + key);
        const tz = (fc.city && fc.city.timezone) || cur.timezone || 0;
        const local = (dt) => (dt + tz) * 1000;
        const w = cur.weather[0];
        const nowLocal = local(cur.dt);

        const slots = fc.list.map(e => ({
            t: local(e.dt), tempC: e.main.temp, pop: Math.round((e.pop || 0) * 100), id: e.weather[0].id,
            code: e.weather[0].icon, text: e.weather[0].description, hi: e.main.temp_max, lo: e.main.temp_min
        }));
        const days = new Map();
        slots.forEach(s => {
            const k = dayKey(s.t);
            const d = days.get(k) || { t: Date.parse(k + 'T00:00Z'), hiC: -Infinity, loC: Infinity, pop: 0, best: null };
            d.hiC = Math.max(d.hiC, s.hi); d.loC = Math.min(d.loC, s.lo); d.pop = Math.max(d.pop, s.pop);
            const dist = Math.abs(minutesOfDay(s.t) - 13 * 60);
            if (!d.best || dist < d.best.dist) d.best = { dist, s };
            days.set(k, d);
        });
        return {
            place: cur.name + (cur.sys && cur.sys.country ? ', ' + cur.sys.country : ''),
            tempC: cur.main.temp, feelsC: cur.main.feels_like, text: cap(w.description), icon: fromOWM(w.id, w.icon),
            humidity: cur.main.humidity, windKph: cur.wind ? cur.wind.speed * 3.6 : null, windDir: cur.wind ? cur.wind.deg : null,
            pressureHpa: cur.main.pressure, precipMm: cur.rain ? cur.rain['1h'] || null : null, nowLocal,
            hourly: slots.slice(0, 12).map(s => ({ t: s.t, tempC: s.tempC, pop: s.pop, icon: fromOWM(s.id, s.code) })),
            daily: Array.from(days.values()).map(d => ({
                t: d.t, hiC: d.hiC, loC: d.loC, pop: d.pop, icon: fromOWM(d.best.s.id, d.best.s.code.replace('n', 'd')),
                text: cap(d.best.s.text)
            })),
            source: { name: 'OpenWeatherMap', url: 'https://openweathermap.org/' }
        };
    }

    function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

    // ---------------------------------------------------------------- WeatherAPI.com

    async function weatherApi(cfg) {
        requireKey(cfg, 'WeatherAPI.com');
        let q = cfg.term;
        if (!q) {
            if (cfg.geo) {
                try { const p = await locateCurrent(cfg); q = p.lat + ',' + p.lon; } catch (e) { /* use IP */ }
            }
            q = q || 'auto:ip';
        }
        let r;
        try {
            r = await getJSON('https://api.weatherapi.com/v1/forecast.json?key=' + enc(cfg.apiKey) + '&q=' + enc(q) +
                '&days=7&aqi=no&alerts=no&lang=' + enc((cfg.lang || 'en').toLowerCase()));
        } catch (e) {
            const code = e.body && e.body.error && e.body.error.code;
            if (code === 1006) throw new EPWError('location', 'WeatherAPI.com could not find "' + cfg.term + '"');
            if (code === 1002 || code === 2006 || code === 2007 || code === 2008 || code === 2009) {
                throw new EPWError('key', 'WeatherAPI.com: ' + e.body.error.message);
            }
            throw e;
        }
        const c = r.current;
        const isDay = !!c.is_day;
        const nowLocal = wallClock(r.location.localtime);
        const cond = (cd) => fromWWO(cd.code - 887, isDay, null);
        const hourly = [];
        r.forecast.forecastday.forEach(d => d.hour.forEach(h => {
            hourly.push({
                t: wallClock(h.time), tempC: h.temp_c, pop: num(h.chance_of_rain),
                icon: fromWWO(h.condition.code - 887, !!h.is_day).icon
            });
        }));
        return {
            place: [r.location.name, r.location.region && r.location.region !== r.location.name ? r.location.region : r.location.country].filter(Boolean).join(', '),
            tempC: c.temp_c, feelsC: c.feelslike_c, text: c.condition.text, icon: cond(c.condition).icon,
            humidity: c.humidity, windKph: c.wind_kph, windDir: c.wind_degree, pressureHpa: c.pressure_mb,
            precipMm: c.precip_mm, nowLocal,
            hourly: upcoming(hourly, nowLocal, 24),
            daily: r.forecast.forecastday.map(d => ({
                t: wallClock(d.date), hiC: d.day.maxtemp_c, loC: d.day.mintemp_c,
                pop: Math.max(num(d.day.daily_chance_of_rain) || 0, num(d.day.daily_chance_of_snow) || 0),
                icon: fromWWO(d.day.condition.code - 887, true).icon, text: d.day.condition.text
            })),
            source: { name: 'WeatherAPI.com', url: 'https://www.weatherapi.com/' }
        };
    }

    // ---------------------------------------------------------------- entry point

    const ADAPTERS = {};
    ADAPTERS[PROVIDER.OPENMETEO] = openMeteo;
    ADAPTERS[PROVIDER.NWS] = nws;
    ADAPTERS[PROVIDER.WTTR] = wttr;
    ADAPTERS[PROVIDER.OWM] = openWeatherMap;
    ADAPTERS[PROVIDER.WEATHERAPI] = weatherApi;

    async function fetchWeather(input) {
        const adapter = ADAPTERS[input.provider];
        if (!adapter) throw new EPWError('unsupported', 'Unknown weather provider ' + input.provider);
        // The host passes the Windows locale ("en-US"); the APIs want a bare language code ("en"). Keys are
        // often pasted with stray whitespace.
        const cfg = Object.assign({}, input, {
            lang: String(input.lang || 'en').slice(0, 2).toLowerCase(),
            term: String(input.term || '').trim(),
            apiKey: String(input.apiKey || '').trim()
        });
        const model = await adapter(cfg);
        if (typeof model.tempC !== 'number' || !isFinite(model.tempC)) throw new EPWError('network', 'The provider returned no temperature');
        if (ICON_KEYS.indexOf(model.icon) < 0) model.icon = 'cloudy';
        return model;
    }

    const api = {
        PROVIDER, NEEDS_KEY, ICON_KEYS, EPWError, fetchWeather,
        _internal: { zoneNow, fromWMO, fromWWO, fromOWM, fromText, wallClock, clock12, geocode, upcoming, dayIcon }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EPW = api;
})(typeof window !== 'undefined' ? window : globalThis);
