// Live smoke test of the keyless providers (needs network). Usage: node test/live_smoke.js [term]
const EPW = require('../providers.js');
const term = process.argv[2] ?? 'Chicago, IL';
const base = { term, lang: 'en', unit: 'C', apiKey: '', geo: false };
(async () => {
    for (const [name, id] of [['Open-Meteo', 2], ['NWS', 3], ['wttr.in', 4]]) {
        const t0 = Date.now();
        try {
            const m = await EPW.fetchWeather({ ...base, provider: id });
            console.log(`\n== ${name} (${Date.now() - t0} ms)`);
            console.log(`${m.place} | ${m.tempC.toFixed(1)}C feels ${m.feelsC?.toFixed?.(1)} | "${m.text}" [${m.icon}]`);
            console.log(`hum ${m.humidity} wind ${m.windKph?.toFixed?.(0)}kph@${m.windDir} press ${m.pressureHpa?.toFixed?.(0)} now ${new Date(m.nowLocal).toISOString()}`);
            console.log('hourly', m.hourly.length, m.hourly.slice(0, 3).map(h => `${new Date(h.t).toISOString().slice(11, 16)} ${h.tempC.toFixed(0)}C ${h.icon} ${h.pop}%`).join(' | '));
            console.log('daily ', m.daily.length, m.daily.map(d => `${new Date(d.t).toISOString().slice(5, 10)} ${d.loC.toFixed(0)}/${d.hiC.toFixed(0)} ${d.icon}`).join(' | '));
        } catch (e) { console.log(`\n== ${name} FAILED: [${e.kind}] ${e.message}`); }
    }
})();
