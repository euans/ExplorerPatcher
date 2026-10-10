// Offline tests: key-based providers (mocked responses in the providers' documented shapes), error
// classification, and the condition tables. Usage (from provider_open/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const EPW = require('../providers.js');
const { fromWMO, fromWWO, fromOWM, fromText, wallClock, clock12 } = EPW._internal;

function mockFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        for (const [re, reply] of routes) {
            if (re.test(url)) {
                const r = typeof reply === 'function' ? reply(url) : reply;
                return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
            }
        }
        throw new Error('unmocked ' + url);
    };
    return calls;
}
const cfg = (o) => ({ provider: 5, term: 'Paris', lang: 'en', unit: 'C', apiKey: 'KEY123', geo: false, ...o });

// OpenWeatherMap: current at 2026-10-09 12:00 UTC in a UTC+2 city, 3-hourly forecast.
const owmCur = {
    coord: { lat: 48.85, lon: 2.35 }, weather: [{ id: 802, description: 'scattered clouds', icon: '03d' }],
    main: { temp: 14.2, feels_like: 13.1, pressure: 1015, humidity: 70 }, wind: { speed: 5, deg: 200 }, dt: 1791547200,
    sys: { country: 'FR' }, timezone: 7200, name: 'Paris'
};
const slot = (dt, temp, id, icon, pop) => ({ dt, main: { temp, temp_min: temp - 1, temp_max: temp + 1 }, weather: [{ id, description: 'x', icon }], pop });
const owmFc = {
    city: { timezone: 7200 }, list: [
        slot(1791547200, 15, 802, '03d', 0.1), slot(1791558000, 12, 500, '10n', 0.6), slot(1791568800, 10, 800, '01n', 0),
        slot(1791633600, 17, 501, '10d', 0.8), slot(1791644400, 14, 804, '04d', 0.2)]
};

test('OpenWeatherMap maps current, hourly and daily', async () => {
    const calls = mockFetch([[/data\/2\.5\/weather/, { body: owmCur }], [/data\/2\.5\/forecast/, { body: owmFc }]]);
    const m = await EPW.fetchWeather(cfg());
    assert.equal(m.place, 'Paris, FR');
    assert.equal(m.tempC, 14.2);
    assert.equal(m.icon, 'partly-day');
    assert.equal(m.text, 'Scattered clouds');
    assert.ok(Math.abs(m.windKph - 18) < 0.01);                 // 5 m/s
    assert.equal(new Date(m.nowLocal).toISOString(), '2026-10-09T14:00:00.000Z'); // 12:00 UTC + 2 h
    assert.equal(m.hourly.length, 5);
    assert.equal(m.hourly[1].icon, 'rain');
    assert.equal(m.hourly[1].pop, 60);
    assert.equal(m.daily.length, 2);
    assert.equal(m.daily[0].hiC, 16);
    const weatherCall = calls.find(c => /data\/2\.5\/weather/.test(c));   // (the geocoder is tried first and is not mocked here)
    assert.match(weatherCall, /appid=KEY123/);
    assert.match(weatherCall, /q=Paris/);
});

const geocodeParma = { body: { results: [
    { name: 'Parma', latitude: 44.8, longitude: 10.33, country_code: 'IT', country: 'Italy', admin1: 'Emilia-Romagna', timezone: 'Europe/Rome' },
    { name: 'Parma', latitude: 41.4, longitude: -81.72, country_code: 'US', country: 'United States', admin1: 'Ohio', timezone: 'America/New_York' }] } };

test('OpenWeatherMap resolves "city, state" through the geocoder instead of sending q=parma, oh', async () => {
    const calls = mockFetch([[/geocoding-api/, geocodeParma], [/weather\?/, { body: owmCur }], [/forecast/, { body: owmFc }]]);
    const m = await EPW.fetchWeather(cfg({ term: 'parma, oh' }));
    const weatherCall = calls.find(c => /data\/2\.5\/weather/.test(c));
    assert.match(weatherCall, /lat=41\.4&lon=-81\.72/);
    assert.ok(!/q=/.test(weatherCall.replace('&appid', '')), 'must not use q=');
    assert.equal(m.place, 'Parma, Ohio');
});

test('WeatherAPI.com sends coordinates from the geocoder for a "city, state" term', async () => {
    const calls = mockFetch([[/geocoding-api/, geocodeParma], [/weatherapi\.com/, { status: 400, body: { error: { code: 1006, message: 'x' } } }]]);
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 6, term: 'parma, oh' })), (e) => e.kind === 'location');
    assert.match(calls.find(c => /weatherapi\.com/.test(c)), /q=41\.4%2C-81\.72/);
});

test('OpenWeatherMap falls back to q= when the geocoder finds nothing', async () => {
    const calls = mockFetch([[/geocoding-api/, { body: {} }], [/weather\?/, { body: owmCur }], [/forecast/, { body: owmFc }]]);
    await EPW.fetchWeather(cfg({ term: 'Zzyzx' }));
    assert.match(calls.find(c => /data\/2\.5\/weather/.test(c)), /q=Zzyzx/);
});

test('OpenWeatherMap uses zip= for 5 digit terms', async () => {
    const calls = mockFetch([[/weather\?/, { body: owmCur }], [/forecast/, { body: owmFc }]]);
    await EPW.fetchWeather(cfg({ term: '60601' }));
    assert.match(calls[0], /zip=60601%2Cus/);
});

test('missing key is a soft "key" error and makes no request', async () => {
    const calls = mockFetch([]);
    for (const provider of [5, 6]) {
        await assert.rejects(EPW.fetchWeather(cfg({ provider, apiKey: '' })), (e) => e.kind === 'key');
    }
    assert.equal(calls.length, 0);
});

test('OpenWeatherMap 401 -> key, 404 -> location', async () => {
    mockFetch([[/weather\?/, { status: 401, body: { cod: 401 } }]]);
    await assert.rejects(EPW.fetchWeather(cfg()), (e) => e.kind === 'key');
    mockFetch([[/weather\?/, { status: 404, body: { cod: '404' } }]]);
    await assert.rejects(EPW.fetchWeather(cfg()), (e) => e.kind === 'location');
});

// WeatherAPI.com
const wapiHour = (time, c, code, day) => ({ time, temp_c: c, condition: { code, text: 'x' }, chance_of_rain: 30, is_day: day });
const wapi = {
    location: { name: 'London', region: 'City of London, Greater London', country: 'UK', localtime: '2026-10-9 14:30' },
    current: {
        temp_c: 11, feelslike_c: 9.5, condition: { text: 'Light rain', code: 1183 }, is_day: 1, humidity: 80, wind_kph: 20,
        wind_degree: 250, pressure_mb: 1004, precip_mm: 0.4
    },
    forecast: {
        forecastday: [
            {
                date: '2026-10-09', day: { maxtemp_c: 13, mintemp_c: 7, daily_chance_of_rain: 80, condition: { text: 'Rain', code: 1189 } },
                hour: [wapiHour('2026-10-09 13:00', 11, 1183, 1), wapiHour('2026-10-09 14:00', 11, 1183, 1), wapiHour('2026-10-09 15:00', 12, 1000, 1), wapiHour('2026-10-09 23:00', 8, 1000, 0)]
            },
            {
                date: '2026-10-10', day: { maxtemp_c: 15, mintemp_c: 6, daily_chance_of_rain: 10, condition: { text: 'Sunny', code: 1000 } },
                hour: [wapiHour('2026-10-10 00:00', 7, 1003, 0)]
            }]
    }
};

test('WeatherAPI maps current, hourly and daily', async () => {
    const calls = mockFetch([[/forecast\.json/, { body: wapi }]]);
    const m = await EPW.fetchWeather(cfg({ provider: 6, term: '' }));
    assert.match(calls[0], /q=auto%3Aip/);
    assert.equal(m.place, 'London, City of London, Greater London');
    assert.equal(m.icon, 'rain');                      // 1183 light rain
    assert.equal(new Date(m.nowLocal).toISOString(), '2026-10-09T14:30:00.000Z'); // non padded hour parsed
    // 13:00 is dropped (more than 45 min before 14:30); the night hours use night icons
    assert.deepEqual(m.hourly.map(h => h.icon), ['rain', 'clear-day', 'clear-night', 'partly-night']);
    assert.equal(m.daily.length, 2);
    assert.equal(m.daily[1].icon, 'clear-day');
    assert.equal(m.daily[0].pop, 80);
});

test('WeatherAPI error codes', async () => {
    const err = (code, message) => ({ status: 400, body: { error: { code, message } } });
    mockFetch([[/forecast\.json/, err(2006, 'API key is invalid.')]]);
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 6 })), (e) => e.kind === 'key');
    mockFetch([[/forecast\.json/, err(1006, 'No matching location found.')]]);
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 6 })), (e) => e.kind === 'location');
    mockFetch([[/forecast\.json/, { status: 500, body: null }]]);
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 6 })), (e) => e.kind === 'network');
});

test('network failure is classified', async () => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 2 })), (e) => e.kind === 'network');
});

test('NWS refuses non-US locations', async () => {
    mockFetch([[/geocoding-api/, { body: { results: [{ name: 'Paris', country: 'France', country_code: 'FR', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris' }] } }]]);
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 3 })), (e) => e.kind === 'unsupported');
});

test('geocoder disambiguates "City, ST" and reports unknown places', async () => {
    const hits = [
        { name: 'Springfield', admin1: 'Missouri', country_code: 'US', country: 'United States', latitude: 1, longitude: 1 },
        { name: 'Springfield', admin1: 'Illinois', country_code: 'US', country: 'United States', latitude: 2, longitude: 2 }];
    mockFetch([[/geocoding-api/, { body: { results: hits } }]]);
    const g = await EPW._internal.geocode('Springfield, Illinois', 'en');
    assert.equal(g.lat, 2);
    mockFetch([[/geocoding-api/, { body: {} }]]);
    await assert.rejects(EPW._internal.geocode('Nowhereville', 'en'), (e) => e.kind === 'location');
});

test('unknown provider id', async () => {
    await assert.rejects(EPW.fetchWeather(cfg({ provider: 99 })), (e) => e.kind === 'unsupported');
});

test('condition tables only ever return bundled icons', () => {
    const ok = (i) => assert.ok(EPW.ICON_KEYS.includes(i), 'bad icon ' + i);
    for (let c = 0; c < 100; c++) for (const d of [0, 1]) ok(fromWMO(c, d).icon);
    for (let c = 100; c < 400; c++) for (const d of [false, true]) ok(fromWWO(c, d).icon);
    for (let c = 200; c < 900; c++) for (const s of ['d', 'n']) ok(fromOWM(c, '01' + s));
    for (const t of ['Chance Showers And Thunderstorms', 'Mostly Sunny', 'Patchy Fog', 'Wintry Mix', 'x', '']) for (const d of [false, true]) ok(fromText(t, d));
});

test('spot checks', () => {
    assert.equal(fromWMO(0, 0).icon, 'clear-night');
    assert.equal(fromWMO(95, 1).icon, 'thunder');
    assert.equal(fromWMO(66, 1).icon, 'sleet');
    assert.equal(fromWWO(1183 - 887, 1).icon, 'rain');
    assert.equal(fromWWO(1087 - 887, 0).icon, 'thunder');
    assert.equal(fromOWM(804, '04n'), 'cloudy');
    assert.equal(fromOWM(800, '01n'), 'clear-night');
    assert.equal(fromText('Mostly Cloudy', true), 'cloudy');
    assert.equal(fromText('Partly Sunny', true), 'partly-day');
    assert.equal(fromText('Slight Chance Light Snow', false), 'snow');
    assert.equal(clock12('06:50 PM'), 18 * 60 + 50);
    assert.equal(clock12('12:05 AM'), 5);
    assert.equal(wallClock('2026-10-09T14:00:00-05:00'), Date.UTC(2026, 9, 9, 14, 0));
});
