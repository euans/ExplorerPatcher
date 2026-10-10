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
    const table = [...c.matchAll(/\{ L"([a-z-]+)", \{ (IDR_EPW_ICON_[A-Z_]+), (IDR_EPW_ICON_WHITE_[A-Z_]+), (IDR_EPW_ICON_PIXEL_[A-Z_]+), (IDR_EPW_ICON_MATERIAL_[A-Z_]+), (IDR_EPW_ICON_MATERIALCOLOR_[A-Z_]+) \} \}/g)]
        .map(m => ({ name: m[1], ids: [m[2], m[3], m[4], m[5], m[6]] }));
    assert.deepEqual(table.map(t => t.name).sort(), pngs);
    const rc = read(host, 'ep_weather_host.rc');
    const resourceH = read(host, 'resource.h');
    for (const { name, ids } of table) {
        // one icon set per pack: the default folder, white\ and pixel\ (the rc file doubles every backslash)
        ids.forEach((id, i) => {
            const dir = ['icons\\\\\\\\', 'icons\\\\\\\\white\\\\\\\\', 'icons\\\\\\\\pixel\\\\\\\\', 'icons\\\\\\\\material\\\\\\\\', 'icons\\\\\\\\material-color\\\\\\\\'][i];
            assert.match(rc, new RegExp(id + '\\s+RCDATA\\s+"provider_open\\\\\\\\' + dir + name + '\\.png"'), 'rc entry ' + id);
            assert.match(resourceH, new RegExp('#define ' + id + '\\s+\\d+'), 'resource.h id ' + id);
        });
    }
});

test('every icon pack has the same 12 files', () => {
    for (const pack of ['white', 'pixel', 'material', 'material-color']) {
        const names = fs.readdirSync(path.join(open, 'icons', pack)).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort();
        assert.deepEqual(names, pngs, pack);
    }
});

test('PNG icons are real, square, transparent PNGs', () => {
    for (const pack of ['', 'white', 'pixel', 'material', 'material-color']) {
        for (const n of pngs) {
            const b = fs.readFileSync(path.join(open, 'icons', pack, n + '.png'));
            const label = pack + '/' + n;
            assert.equal(b.subarray(1, 4).toString(), 'PNG', label);
            assert.equal(b.readUInt32BE(16), 128, label + ' width');
            assert.equal(b.readUInt32BE(20), 128, label + ' height');
            assert.equal(b[25], 6, label + ' must be RGBA (color type 6)');
        }
    }
});

test('icon-set constants and registry names agree between the C sources, the settings pages and ui.js', () => {
    const h = read(host, 'ep_weather.h');
    for (const [k, v] of Object.entries({ COLOR: 0, WHITE: 1, PIXEL: 2, MATERIAL: 3, MATERIALCOLOR: 4 })) {
        assert.match(h, new RegExp('#define EP_WEATHER_OPENICONS_' + k + '\\s+' + v + '\\b'));
    }
    assert.match(h, /#define EP_WEATHER_NUM_OPENICONS 5/);
    const res = path.join(repo, 'ep_gui', 'resources');
    for (const name of ['settings.reg', 'settings10.reg']) {
        const reg = read(res, name);
        assert.match(reg, /;c 5 %R:1572%\r?\n(;x \d %R:157\d%\r?\n){5}"WeatherOpenIconsTaskbar"=dword:00000000/);
        assert.match(reg, /;c 5 %R:1576%\r?\n(;x \d %R:157\d%\r?\n){5}"WeatherOpenIconsFlyout"=dword:00000000/);
    }
    const header = read(res, 'EPSettingsResources.h');
    const rc = read(res, 'lang', 'ep_gui.en-US.rc');
    for (const id of ['1572', '1573', '1574', '1575', '1576', '1577', '1578']) {
        const sym = header.match(new RegExp('#define (IDS_\\w+) ' + id + '\\b'))[1];
        assert.match(rc, new RegExp('^\\s+' + sym + '\\s+"', 'm'), sym);
    }
    const dll = read(repo, 'ExplorerPatcher', 'dllmain.c');
    for (const v of ['WeatherOpenIconsTaskbar', 'WeatherOpenIconsFlyout']) assert.ok(dll.includes('TEXT("' + v + '")'), v);
    const idl = read(repo, 'ep_weather_host_stub', 'ep_weather_host.idl');
    assert.ok(idl.indexOf('SetOpenIcons') > idl.indexOf('SetApiKey'), 'SetOpenIcons must stay appended after SetApiKey');
    const ui = read(open, 'ui.js');
    for (const v of ['EP_ICONS_TASKBAR', 'EP_ICONS_TASKBAR_PIXEL', 'EP_ICONS_MONO']) assert.ok(ui.includes('window.' + v), v);
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
        // combo has 5 options (Open-Meteo is the default, there is no Google any more) and both key fields are present
        assert.match(reg, /;c 5 %R:1560%\r?\n(;x \d %R:156\d%\r?\n){5}"WeatherProvider"=dword:00000002/);
        assert.doesNotMatch(reg, /WeatherIconPack/);
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

test('the Google source and the Microsoft/Google icon pack setting are gone', () => {
    assert.ok(!fs.existsSync(path.join(host, 'ep_weather_provider_google_script.h')));
    assert.ok(!fs.existsSync(path.join(host, 'ep_weather_provider_google_html.h')));
    assert.doesNotMatch(read(host, 'ep_weather.h'), /PROVIDER_GOOGLE|ICONPACK/);
    assert.doesNotMatch(read(host, 'ep_weather_host.c'), /EP_WEATHER_PROVIDER_GOOGLE|provider_google/);
    const dll = read(repo, 'ExplorerPatcher', 'dllmain.c');
    assert.doesNotMatch(dll, /WeatherIconPack|PROVIDER_GOOGLE/);
    assert.match(dll, /DWORD dwWeatherProvider = EP_WEATHER_PROVIDER_OPENMETEO;/);
});
