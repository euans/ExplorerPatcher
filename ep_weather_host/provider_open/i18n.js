/*
 * Texts of the flyout for the languages ExplorerPatcher's WeatherLanguage setting can name. Dates, hours and weekday
 * names come from Intl and are localized by the browser; this file covers what Intl cannot:
 *
 *   ui    the fixed labels of the flyout ("Feels like", "Updated" ...) and the compass directions
 *   cond  condition names. Keys are the English texts providers.js produces for Open-Meteo (WMO codes). OpenWeatherMap,
 *         WeatherAPI.com and wttr.in already return text in the requested language, and the National Weather
 *         Service only publishes English, so those pass through unchanged.
 *
 * Any language that is not listed here (or any text that is missing) falls back to English.
 * Runs in the WebView2 page and under Node for testing (see test/assets.test.js).
 */
(function (root) {
    'use strict';

    const EN = {
        ui: {
            feels: 'Feels like', humidity: 'Humidity', wind: 'Wind', pressure: 'Pressure', now: 'Now', today: 'Today',
            dataBy: 'Weather data by ', updated: 'Updated ', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
        },
        cond: null
    };

    // English condition texts, in the order of the arrays below.
    const KEYS = [
        'Clear', 'Mainly clear', 'Partly cloudy', 'Overcast', 'Fog', 'Rime fog', 'Light drizzle', 'Drizzle', 'Heavy drizzle',
        'Freezing drizzle', 'Heavy freezing drizzle', 'Light rain', 'Rain', 'Heavy rain', 'Freezing rain', 'Heavy freezing rain',
        'Light snow', 'Snow', 'Heavy snow', 'Snow grains', 'Light rain showers', 'Rain showers', 'Violent rain showers',
        'Snow showers', 'Heavy snow showers', 'Thunderstorm', 'Thunderstorm with hail', 'Thunderstorm with heavy hail',
        'Sunny', 'Unknown'
    ];

    function pack(ui, texts) {
        const cond = {};
        KEYS.forEach((k, i) => { cond[k] = texts[i]; });
        return { ui, cond };
    }

    const LANGS = {
        de: pack({
            feels: 'Gefühlt', humidity: 'Luftfeuchte', wind: 'Wind', pressure: 'Luftdruck', now: 'Jetzt', today: 'Heute',
            dataBy: 'Wetterdaten von ', updated: 'Aktualisiert ', dirs: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
        }, [
            'Klar', 'Überwiegend klar', 'Teils bewölkt', 'Bedeckt', 'Nebel', 'Reifnebel', 'Leichter Nieselregen', 'Nieselregen',
            'Starker Nieselregen', 'Gefrierender Nieselregen', 'Starker gefrierender Nieselregen', 'Leichter Regen', 'Regen',
            'Starker Regen', 'Gefrierender Regen', 'Starker gefrierender Regen', 'Leichter Schneefall', 'Schneefall',
            'Starker Schneefall', 'Schneegriesel', 'Leichte Regenschauer', 'Regenschauer', 'Heftige Regenschauer',
            'Schneeschauer', 'Starke Schneeschauer', 'Gewitter', 'Gewitter mit Hagel', 'Gewitter mit starkem Hagel',
            'Sonnig', 'Unbekannt'
        ]),
        fr: pack({
            feels: 'Ressenti', humidity: 'Humidité', wind: 'Vent', pressure: 'Pression', now: 'Maint.', today: 'Aujourd’hui',
            dataBy: 'Données météo : ', updated: 'Mis à jour ', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
        }, [
            'Dégagé', 'Plutôt dégagé', 'Partiellement nuageux', 'Couvert', 'Brouillard', 'Brouillard givrant', 'Bruine légère',
            'Bruine', 'Forte bruine', 'Bruine verglaçante', 'Forte bruine verglaçante', 'Pluie légère', 'Pluie', 'Forte pluie',
            'Pluie verglaçante', 'Forte pluie verglaçante', 'Neige légère', 'Neige', 'Forte neige', 'Neige en grains',
            'Averses légères', 'Averses', 'Averses violentes', 'Averses de neige', 'Fortes averses de neige', 'Orage',
            'Orage avec grêle', 'Orage avec forte grêle', 'Ensoleillé', 'Inconnu'
        ]),
        es: pack({
            feels: 'Sensación', humidity: 'Humedad', wind: 'Viento', pressure: 'Presión', now: 'Ahora', today: 'Hoy',
            dataBy: 'Datos meteorológicos de ', updated: 'Actualizado ', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
        }, [
            'Despejado', 'Mayormente despejado', 'Parcialmente nublado', 'Nublado', 'Niebla', 'Niebla engelante',
            'Llovizna ligera', 'Llovizna', 'Llovizna intensa', 'Llovizna helada', 'Llovizna helada intensa', 'Lluvia ligera',
            'Lluvia', 'Lluvia intensa', 'Lluvia helada', 'Lluvia helada intensa', 'Nieve ligera', 'Nieve', 'Nieve intensa',
            'Granos de nieve', 'Chubascos ligeros', 'Chubascos', 'Chubascos violentos', 'Chubascos de nieve',
            'Fuertes chubascos de nieve', 'Tormenta', 'Tormenta con granizo', 'Tormenta con granizo fuerte', 'Soleado',
            'Desconocido'
        ]),
        it: pack({
            feels: 'Percepita', humidity: 'Umidità', wind: 'Vento', pressure: 'Pressione', now: 'Adesso', today: 'Oggi',
            dataBy: 'Dati meteo di ', updated: 'Aggiornato ', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
        }, [
            'Sereno', 'Prevalentemente sereno', 'Parzialmente nuvoloso', 'Coperto', 'Nebbia', 'Nebbia con brina',
            'Pioviggine leggera', 'Pioviggine', 'Pioviggine intensa', 'Pioviggine gelata', 'Pioviggine gelata intensa',
            'Pioggia leggera', 'Pioggia', 'Pioggia intensa', 'Pioggia gelata', 'Pioggia gelata intensa', 'Neve leggera', 'Neve',
            'Neve intensa', 'Granelli di neve', 'Rovesci leggeri', 'Rovesci di pioggia', 'Rovesci violenti', 'Rovesci di neve',
            'Forti rovesci di neve', 'Temporale', 'Temporale con grandine', 'Temporale con forte grandine', 'Soleggiato',
            'Sconosciuto'
        ]),
        pt: pack({
            feels: 'Sensação', humidity: 'Umidade', wind: 'Vento', pressure: 'Pressão', now: 'Agora', today: 'Hoje',
            dataBy: 'Dados meteorológicos de ', updated: 'Atualizado ', dirs: ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']
        }, [
            'Limpo', 'Predominantemente limpo', 'Parcialmente nublado', 'Encoberto', 'Nevoeiro', 'Nevoeiro com geada',
            'Garoa leve', 'Garoa', 'Garoa forte', 'Garoa congelante', 'Garoa congelante forte', 'Chuva leve', 'Chuva',
            'Chuva forte', 'Chuva congelante', 'Chuva congelante forte', 'Neve leve', 'Neve', 'Neve forte', 'Grãos de neve',
            'Pancadas de chuva leves', 'Pancadas de chuva', 'Pancadas de chuva violentas', 'Pancadas de neve',
            'Pancadas de neve fortes', 'Trovoada', 'Trovoada com granizo', 'Trovoada com granizo forte', 'Ensolarado',
            'Desconhecido'
        ]),
        nl: pack({
            feels: 'Voelt als', humidity: 'Vochtigheid', wind: 'Wind', pressure: 'Luchtdruk', now: 'Nu', today: 'Vandaag',
            dataBy: 'Weergegevens van ', updated: 'Bijgewerkt ', dirs: ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW']
        }, [
            'Helder', 'Overwegend helder', 'Half bewolkt', 'Bewolkt', 'Mist', 'Rijpmist', 'Lichte motregen', 'Motregen',
            'Zware motregen', 'IJzelachtige motregen', 'Zware ijzelachtige motregen', 'Lichte regen', 'Regen', 'Zware regen',
            'IJzel', 'Zware ijzel', 'Lichte sneeuw', 'Sneeuw', 'Zware sneeuw', 'Sneeuwkorrels', 'Lichte regenbuien',
            'Regenbuien', 'Zware regenbuien', 'Sneeuwbuien', 'Zware sneeuwbuien', 'Onweer', 'Onweer met hagel',
            'Onweer met zware hagel', 'Zonnig', 'Onbekend'
        ])
    };

    // The strings for a language tag such as "de", "de-AT" or "pt_BR"; English when there is no translation.
    function forLanguage(tag) {
        const l = LANGS[String(tag || 'en').toLowerCase().slice(0, 2)];
        return {
            ui: Object.assign({}, EN.ui, l && l.ui),
            translate: (text) => (l && l.cond[text]) || text,
            translated: !!l
        };
    }

    const api = { EN, KEYS, LANGS, forLanguage };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EP_I18N = api;
})(typeof window !== 'undefined' ? window : globalThis);
