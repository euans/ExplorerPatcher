/*
 * Flyout rendering and the host protocol for the weather providers.
 *
 * ep_weather_host injects, before this script runs:
 *   window.EP_CFG   { provider, term, lang, unit: 'C'|'F', apiKey, geo, iconSize, textScale }
 *   window.EP_ICONS { '<icon key>': 'data:image/png;base64,...' }     icons shown in the flyout
 *   window.EP_ICONS_TASKBAR                                           icons for the taskbar widget (absent = same as EP_ICONS)
 *   window.EP_ICONS_TASKBAR_PIXEL                                     true = draw the taskbar icon without smoothing
 *   window.EP_ICONS_MONO                                              true = flyout icons are white only (inverted on the light theme)
 * and then polls window.ep_weather_poll() until it stops returning "ep_pending". Possible results:
 *   "ep_pending"                         still working
 *   "ep_error:<kind>:<message>"          could not get data -> host shows its generic error page
 *   "<dir>#<height>#<temp>#<unit>#<condition>#<location>#<hex>"
 *                                        the host parses this for the taskbar widget; <hex> is the taskbar icon as
 *                                        premultiplied BGRA pixels (iconSize x iconSize), hex encoded
 */
(function () {
    'use strict';
    const cfg = window.EP_CFG;
    const icons = window.EP_ICONS || {};
    const taskbarIcons = window.EP_ICONS_TASKBAR || icons;
    if (window.EP_ICONS_MONO) document.documentElement.classList.add('mono-icons');
    const $ = (id) => document.getElementById(id);
    const PAGE_HEIGHT = 367;            // the host maps this to its fixed flyout height (EP_WEATHER_HEIGHT)
    const WATCHDOG_MS = 45000;

    let result = null;                  // final string handed to the host

    const rtl = /^(ar|he|iw|fa|ur|ps|sd|ug|yi|dv|ckb)(-|_|$)/i.test(cfg.lang || '');
    const lang = (() => {
        try { return Intl.DateTimeFormat.supportedLocalesOf([cfg.lang]).length ? cfg.lang : 'en'; } catch (e) { return 'en'; }
    })();
    const fahrenheit = cfg.unit === 'F';
    // Labels and Open-Meteo condition names in the chosen language (English when there is no translation, see i18n.js).
    const T = window.EP_I18N ? window.EP_I18N.forLanguage(cfg.lang) : { ui: null, translate: (s) => s };
    const ui = T.ui || { feels: 'Feels like', humidity: 'Humidity', wind: 'Wind', pressure: 'Pressure', now: 'Now', today: 'Today', dataBy: 'Weather data by ', updated: 'Updated ', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] };

    // ------------------------------------------------------------ formatting

    const deg = (c) => Math.round(fahrenheit ? c * 9 / 5 + 32 : c);
    const unitLabel = () => '°' + (fahrenheit ? 'F' : 'C');
    const hourFmt = new Intl.DateTimeFormat(lang, { hour: 'numeric', timeZone: 'UTC' });
    const dayFmt = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });

    function wind(m) {
        if (m.windKph === null || m.windKph === undefined) return '–';
        const speed = fahrenheit ? Math.round(m.windKph / 1.609) + ' mph' : Math.round(m.windKph) + ' km/h';
        return speed + (m.windDir === null || m.windDir === undefined ? '' : ' ' + ui.dirs[Math.round(m.windDir / 45) % 8]);
    }

    function pressure(m) {
        if (m.pressureHpa === null || m.pressureHpa === undefined) return '–';
        return fahrenheit ? (m.pressureHpa * 0.02953).toFixed(2) + ' inHg' : Math.round(m.pressureHpa) + ' hPa';
    }

    function clean(s) {   // keep the host's '#'-separated string and its JSON wrapper intact
        return String(s === null || s === undefined ? '' : s).replace(/[#"\\\u0000-\u001f]/g, ' ').trim();
    }

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function iconImg(key, alt) {
        const img = el('img');
        img.src = icons[key] || icons.cloudy || '';
        img.alt = alt || '';
        return img;
    }

    // ------------------------------------------------------------ rendering

    function render(m) {
        $('nowIcon').src = icons[m.icon] || '';
        $('temp').textContent = deg(m.tempC);
        $('unit').textContent = unitLabel();
        $('text').textContent = T.translate(m.text);
        $('place').textContent = m.place;

        const facts = $('facts');
        const rows = [
            [ui.feels, m.feelsC === null || m.feelsC === undefined ? null : deg(m.feelsC) + '°'],
            [ui.humidity, m.humidity === null || m.humidity === undefined ? null : Math.round(m.humidity) + '%'],
            [ui.wind, wind(m)],
            [ui.pressure, pressure(m)]
        ].filter(r => r[1] !== null);
        rows.forEach(r => { facts.appendChild(el('dt', '', r[0])); facts.appendChild(el('dd', '', r[1])); });

        const hourly = $('hourly');
        m.hourly.slice(0, 8).forEach((h, i) => {
            const d = el('div', 'hour');
            d.appendChild(el('div', 't', i === 0 && h.t > m.nowLocal - 45 * 60000 && h.t <= m.nowLocal + 15 * 60000 ? ui.now : hourFmt.format(h.t)));
            d.appendChild(iconImg(h.icon));
            d.appendChild(el('div', 'v', deg(h.tempC) + '°'));
            d.appendChild(el('div', 'p', h.pop ? h.pop + '%' : ''));
            hourly.appendChild(d);
        });

        const daily = $('daily');
        const today = new Date(m.nowLocal).toISOString().slice(0, 10);
        const days = m.daily.slice(0, 5);
        const lowest = Math.min.apply(null, days.map(d => d.loC));
        const span = Math.max(1, Math.max.apply(null, days.map(d => d.hiC)) - lowest);
        days.forEach(dd => {
            const row = el('div', 'day');
            const isToday = new Date(dd.t).toISOString().slice(0, 10) === today;
            row.appendChild(el('div', 'd', isToday && (lang.slice(0, 2) === 'en' || T.translated) ? ui.today : dayFmt.format(dd.t)));
            row.appendChild(iconImg(dd.icon, T.translate(dd.text)));
            row.appendChild(el('div', 'p', dd.pop ? dd.pop + '%' : ''));
            const bar = el('div', 'bar');
            const fill = el('i');
            fill.style.left = ((dd.loC - lowest) / span * 100) + '%';
            fill.style.right = (100 - (dd.hiC - lowest) / span * 100) + '%';
            bar.appendChild(fill);
            row.appendChild(bar);
            const r = el('div', 'r');
            r.appendChild(el('b', '', deg(dd.hiC) + '°'));
            r.appendChild(el('span', '', deg(dd.loC) + '°'));
            row.appendChild(r);
            daily.appendChild(row);
        });

        const src = el('span');
        src.appendChild(document.createTextNode(ui.dataBy));
        const a = el('a', '', m.source.name);
        a.href = m.source.url;
        src.appendChild(a);
        $('source').replaceWith(src);
        $('updated').textContent = ui.updated + new Date().toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
        $('app').hidden = false;
    }

    // Shown for configuration problems the user can fix (missing / rejected API key, unsupported place).
    function renderMessage(title, body) {
        $('msgIcon').src = icons.cloudy || '';
        $('msgTitle').textContent = title;
        $('msgBody').innerHTML = '';
        body.forEach(part => $('msgBody').appendChild(typeof part === 'string' ? document.createTextNode(part) : part));
        $('msg').hidden = false;
    }

    // ------------------------------------------------------------ taskbar payload

    const HEX = Array.from({ length: 256 }, (_, i) => (i < 16 ? '0' : '') + i.toString(16));

    async function iconHex(key, size) {
        const img = new Image();
        img.src = taskbarIcons[key] || taskbarIcons.cloudy;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        // Pixel art is scaled with nearest neighbour so the squares stay sharp.
        ctx.imageSmoothingEnabled = !window.EP_ICONS_TASKBAR_PIXEL;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        const px = ctx.getImageData(0, 0, size, size).data;
        const out = new Array(px.length);
        for (let i = 0; i < px.length; i += 4) {      // RGBA -> premultiplied BGRA
            const a = px[i + 3];
            out[i] = HEX[(px[i + 2] * a + 127) / 255 | 0];
            out[i + 1] = HEX[(px[i + 1] * a + 127) / 255 | 0];
            out[i + 2] = HEX[(px[i] * a + 127) / 255 | 0];
            out[i + 3] = HEX[a];
        }
        return out.join('');
    }

    function payload(temp, unit, text, place, hex) {
        return [rtl ? 'rtl' : 'ltr', PAGE_HEIGHT, clean(temp), clean(unit), clean(text), clean(place), hex].join('#');
    }

    // ------------------------------------------------------------ flow

    const PROVIDER_NAMES = { 2: 'Open-Meteo', 3: 'National Weather Service', 4: 'wttr.in', 5: 'OpenWeatherMap', 6: 'WeatherAPI.com' };

    async function softError(err) {
        const name = PROVIDER_NAMES[cfg.provider] || 'The weather provider';
        const settings = 'Open ExplorerPatcher Properties → Weather and ';
        let title, short, body;
        if (err.kind === 'key') {
            const missing = !cfg.apiKey;
            title = missing ? 'API key needed' : 'API key problem';
            short = missing ? 'API key needed' : 'API key rejected';
            body = [name + (missing ? ' needs an API key. ' : ' did not accept the API key. ') + settings +
                (missing ? 'enter your ' + name + ' key, or choose a provider that needs no key.' : 'check the ' + name + ' key. ' + (err.message || ''))];
        } else {
            title = err.kind === 'unsupported' ? 'Not available here' : 'Location not found';
            short = title;
            body = [err.message + '. ' + settings + 'change the location or provider.'];
        }
        renderMessage(title, body);
        result = payload('--', '', short, name, await iconHex('cloudy', cfg.iconSize));
    }

    async function run() {
        try {
            const m = await window.EPW.fetchWeather(cfg);
            render(m);
            result = payload(deg(m.tempC), unitLabel(), T.translate(m.text), m.place, await iconHex(m.icon, cfg.iconSize));
        } catch (err) {
            try {
                if (err && (err.kind === 'key' || err.kind === 'location' || err.kind === 'unsupported')) await softError(err);
                else result = 'ep_error:' + clean(err && err.kind) + ':' + clean(err && err.message);
            } catch (e2) {
                result = 'ep_error:internal:' + clean(e2 && e2.message);
            }
        }
    }

    if (cfg.textScale && cfg.textScale !== 100) document.body.style.zoom = cfg.textScale / 100;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    const started = Date.now();
    run();

    window.ep_weather_poll = function () {
        if (result !== null) return result;
        if (Date.now() - started > WATCHDOG_MS) return 'ep_error:network:timed out';
        return 'ep_pending';
    };
})();
