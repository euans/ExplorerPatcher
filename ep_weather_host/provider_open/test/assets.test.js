// The C host cannot be built on every machine, so this checks the things it relies on: that the icon names,
// resource ids, rc entries and files all agree, that the page template and scripts are safe to splice into
// one HTML document, and that the settings page strings exist. Usage (from provider_open/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const open = path.join(__dirname, '..');                 // ep_weather_host/provider_open
const host = path.join(open, '..');                      // ep_weather_host
const repo = path.join(host, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const EPW = require('../providers.js');

const pngs = fs.readdirSync(path.join(open, 'icons')).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort();

test('icon names agree between providers.js, the PNG files, the C table and the rc file', () => {
    assert.deepEqual([...EPW.ICON_KEYS].sort(), pngs);
    const c = read(host, 'ep_weather_provider_open.c');
    const table = [...c.matchAll(/\{ L"([a-z-]+)", (IDR_EPW_ICON_[A-Z_]+) \}/g)].map(m => [m[1], m[2]]);
    assert.deepEqual(table.map(t => t[0]).sort(), pngs);
    const rc = read(host, 'ep_weather_host.rc');
    const resourceH = read(host, 'resource.h');
    for (const [name, id] of table) {
        assert.match(rc, new RegExp(id + '\\s+RCDATA\\s+"provider_open\\\\\\\\icons\\\\\\\\' + name + '\\.png"'), 'rc entry for ' + name);
        assert.match(resourceH, new RegExp('#define ' + id + '\\s+\\d+'), 'resource.h id ' + id);
    }
});

test('PNG icons are real, square, transparent PNGs', () => {
    for (const n of pngs) {
        const b = fs.readFileSync(path.join(open, 'icons', n + '.png'));
        assert.equal(b.subarray(1, 4).toString(), 'PNG', n);
        assert.equal(b.readUInt32BE(16), 128, n + ' width');
        assert.equal(b.readUInt32BE(20), 128, n + ' height');
        assert.equal(b[25], 6, n + ' must be RGBA (color type 6)');
    }
});

test('resource ids are unique and every RCDATA file exists', () => {
    const resourceH = read(host, 'resource.h');
    const ids = [...resourceH.matchAll(/#define (IDR_EPW_\w+)\s+(\d+)/g)];
    assert.equal(new Set(ids.map(m => m[2])).size, ids.length, 'duplicate resource id');
    const rc = read(host, 'ep_weather_host.rc');
    const entries = [...rc.matchAll(/^(IDR_EPW_\w+)\s+RCDATA\s+"([^"]+)"/gm)];
    assert.equal(entries.length, ids.length, 'every id needs an rc entry');
    for (const [, id, file] of entries) {
        assert.ok(ids.some(m => m[1] === id), id + ' not in resource.h');
        assert.ok(fs.existsSync(path.join(host, file.replace(/\\\\/g, '/'))), file + ' missing');
    }
});

test('page template has exactly one script marker and the scripts are safe to inline', () => {
    const html = read(open, 'weather.html');
    assert.equal(html.split('<!--EP_SCRIPT-->').length - 1, 1);
    for (const f of ['providers.js', 'ui.js']) {
        const js = read(open, f);
        assert.ok(!/<\/script/i.test(js), f + ' contains </script');
        assert.ok(!/<!--/.test(js), f + ' contains an HTML comment opener');
        new vm.Script(js, { filename: f });                // syntax check
    }
});

test('every file is valid UTF-8 without a BOM surprise (the host strips a BOM, but keep them clean)', () => {
    for (const f of ['weather.html', 'providers.js', 'ui.js']) {
        const b = fs.readFileSync(path.join(open, f));
        assert.ok(!(b[0] === 0xEF && b[1] === 0xBB), f + ' has a BOM');
        assert.equal(Buffer.from(b.toString('utf8'), 'utf8').equals(b), true, f + ' is not valid UTF-8');
    }
});

test('provider ids agree between ep_weather.h and providers.js', () => {
    const h = read(host, 'ep_weather.h');
    const want = { OPENMETEO: 2, NWS: 3, WTTRIN: 4, OPENWEATHERMAP: 5, WEATHERAPI: 6 };
    for (const [k, v] of Object.entries(want)) assert.match(h, new RegExp('#define EP_WEATHER_PROVIDER_' + k + '\\s+' + v + '\\b'));
    assert.match(h, /#define EP_WEATHER_NUM_PROVIDERS 7/);
    assert.deepEqual(EPW.PROVIDER, { OPENMETEO: 2, NWS: 3, WTTR: 4, OWM: 5, WEATHERAPI: 6 });
    assert.deepEqual(Object.keys(EPW.NEEDS_KEY).map(Number), [5, 6]);
});

test('settings strings referenced by the weather entries exist', () => {
    const res = path.join(repo, 'ep_gui', 'resources');
    const header = read(res, 'EPSettingsResources.h');
    const rc = read(res, 'lang', 'ep_gui.en-US.rc');
    const defs = [...header.matchAll(/#define (IDS_\w+) (\d+)/g)];
    const idToName = new Map(defs.map(m => [m[2], m[1]]));
    assert.equal(new Set(defs.map(m => m[2])).size, defs.length, 'duplicate IDS_ number');
    for (const name of ['settings.reg', 'settings10.reg']) {
        const reg = read(res, name);
        const block = reg.slice(reg.indexOf('"WeatherLocation"=""'), reg.indexOf('"WeatherLayout"') > 0 ? undefined : undefined);
        for (const [, id] of reg.matchAll(/%R:(15(?:6\d|7[01]))%/g)) {
            const sym = idToName.get(id);
            assert.ok(sym, name + ': no IDS_ for ' + id);
            assert.match(rc, new RegExp('^\\s+' + sym + '\\s+"', 'm'), sym + ' has no English string');
        }
        // combo has 6 options and 6 x-lines; both key fields are present
        assert.match(reg, /;c 6 %R:1560%\r?\n(;x \d %R:156\d%\r?\n){6}"WeatherProvider"=dword:00000001/);
        assert.match(reg, /"WeatherApiKeyOpenWeatherMap"=""/);
        assert.match(reg, /"WeatherApiKeyWeatherApi"=""/);
        void block;
    }
});

test('registry value names match between the settings pages and dllmain.c', () => {
    const dll = read(repo, 'ExplorerPatcher', 'dllmain.c');
    for (const v of ['WeatherApiKeyOpenWeatherMap', 'WeatherApiKeyWeatherApi', 'WeatherProvider']) {
        assert.ok(dll.includes('"' + v + '"') || dll.includes('L"' + v + '"') || dll.includes('TEXT("' + v + '")'), v + ' not read by dllmain.c');
    }
});
