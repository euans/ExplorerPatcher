// Assembles the flyout page exactly the way ep_weather_provider_open.c does at runtime and writes it to
// test/preview.html, so it can be opened in any browser while iterating on weather.html / ui.js.
//
//   node test/build_preview.js [provider=2] [term="Chicago, IL"] [unit=C] [apiKey=] [dark] [fixed] [lang=de]
//
// Providers: 2 Open-Meteo, 3 NWS, 4 wttr.in, 5 OpenWeatherMap, 6 WeatherAPI.com
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const [provider = '2', term = 'Chicago, IL', unit = 'C', apiKey = ''] = process.argv.slice(2);
const dark = process.argv.includes('dark');
const fixed = process.argv.includes('fixed');   // clamp to the flyout's real 673x353 size
const lang = (process.argv.find(a => a.startsWith('lang=')) || 'lang=en').slice(5);

const icons = {};
for (const f of fs.readdirSync(path.join(root, 'icons')).filter(f => f.endsWith('.png'))) {
    icons[f.slice(0, -4)] = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'icons', f)).toString('base64');
}
const cfg = { provider: +provider, term, lang, unit, apiKey, geo: false, iconSize: 48, textScale: 100 };
// '<' is escaped so a value can never close the <script> element (the host does the same).
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const scripts = '<script>window.EP_CFG=' + json(cfg) + ';window.EP_ICONS=' + json(icons) + ';</script>\n' +
    '<script>' + fs.readFileSync(path.join(root, 'providers.js'), 'utf8') + '</script>\n' +
    '<script>' + fs.readFileSync(path.join(root, 'i18n.js'), 'utf8') + '</script>\n' +
    '<script>' + fs.readFileSync(path.join(root, 'ui.js'), 'utf8') + '</script>\n' +
    // preview only: show what the host would receive, and paint a stand-in for the Mica window
    '<script>setInterval(function(){var r=window.ep_weather_poll();if(r!=="ep_pending"){clearInterval(this);' +
    'document.title=r.length>160?r.slice(0,160)+"...("+r.length+" chars)":r;}},300)</script>';
let html = fs.readFileSync(path.join(root, 'weather.html'), 'utf8').replace('<!--EP_SCRIPT-->', () => scripts);
// The host emulates prefers-color-scheme; a static file cannot, so "dark" forces the dark tokens (appended
// last so they win the cascade).
html = html.replace('</style>', () => 'html{background:' + (dark ? '#202020' : '#f3f3f3') + ' !important}' +
    (dark ? ':root{--text:#f3f3f3;--muted:#a7abb2;--card:rgba(255,255,255,.06);--line:rgba(255,255,255,.12);--accent:#43a7ff;--warn:#ffb15c}' : '') +
    (fixed ? 'html,body{width:673px;height:353px;outline:1px solid #f0f}' : '') + '</style>');
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('wrote test/preview.html (' + html.length + ' chars)');
