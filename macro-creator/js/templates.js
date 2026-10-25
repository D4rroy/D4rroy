/* Makro Studio – Vorlagen (fertige Beispielmakros). */
'use strict';
(function () {
  const MS = window.MS;
  const C = (type, params, extra) => ['constraint', type, params, extra];
  const DAYS_WORK = [1, 2, 3, 4, 5];

  const list = [
    {
      id: 'battery', name: 'Akku-Warnung', icon: 'battery_alert', color: '#e04848', category: 'Gerät',
      description: 'Warnt mit Benachrichtigung und Sprachausgabe, wenn der Akku unter 15 % fällt und nicht geladen wird.',
      triggers: [['battery_level', { dir: 'below', level: 15 }]],
      actions: [
        ['notification', { title: 'Akku schwach', text: 'Nur noch {battery} % – bitte aufladen.' }],
        ['speak', { text: 'Achtung, der Akku ist bei {battery} Prozent.' }],
      ],
      constraints: [['charging', { state: 'not' }]],
    },
    {
      id: 'morning', name: 'Guten-Morgen-Ansage', icon: 'wb_sunny', color: '#f5a524', category: 'Alltag',
      description: 'Sagt werktags um 7:00 Uhr Uhrzeit und Datum an.',
      triggers: [['time', { time: '07:00', days: DAYS_WORK }]],
      actions: [
        ['speak', { text: 'Guten Morgen! Es ist {time} Uhr, {weekday}, der {day}. {month_name}.' }],
        ['notification', { title: 'Guten Morgen', text: 'Akku: {battery} %' }],
      ],
    },
    {
      id: 'charger', name: 'Ladegerät-Hinweis', icon: 'power', color: '#2ea05a', category: 'Gerät',
      description: 'Meldet mit Ton und Vibration, wenn das Ladegerät angeschlossen oder getrennt wird.',
      triggers: [['power', { state: 'any' }]],
      actions: [
        ['toast', { text: 'Ladegerät {trigger_info} – Akku {battery} %' }],
        ['play_sound', { sound: 'chime', volume: 60 }],
        ['vibrate', { pattern: 'short' }],
      ],
    },
    {
      id: 'shake_torch', name: 'Schütteln für Taschenlampe', icon: 'flashlight_on', color: '#475569', category: 'Gerät',
      description: 'Gerät schütteln schaltet die Taschenlampe um (Android/Chrome).',
      triggers: [['shake', { sensitivity: 'medium' }]],
      actions: [['torch', { state: 'toggle' }], ['vibrate', { pattern: 'short' }]],
    },
    {
      id: 'network', name: 'Verbindungswächter', icon: 'wifi_off', color: '#2f7de1', category: 'Gerät',
      description: 'Meldet, wenn die Internetverbindung verloren geht oder zurückkommt – Beispiel für Wenn/Sonst.',
      triggers: [['connectivity', { state: 'any' }]],
      actions: [
        ['if', { conditions: [C('connectivity', { state: 'online' })], logic: 'and' }],
        ['toast', { text: 'Wieder online' }],
        ['else', {}],
        ['notification', { title: 'Keine Verbindung', text: 'Seit {time} Uhr offline.' }],
        ['play_sound', { sound: 'error', volume: 50 }],
        ['end_if', {}],
      ],
    },
    {
      id: 'drink', name: 'Trinkerinnerung', icon: 'local_drink', color: '#0ea5a4', category: 'Gesundheit',
      description: 'Erinnert werktags zwischen 9 und 18 Uhr stündlich ans Trinken.',
      triggers: [['interval', { value: 60, unit: 'min' }]],
      actions: [['notification', { title: 'Zeit für ein Glas Wasser', text: 'Bleib hydriert! ({time})' }]],
      constraints: [['time_range', { from: '09:00', to: '18:00' }], ['weekday', { days: DAYS_WORK }]],
    },
    {
      id: 'counter', name: 'Zähler-Button', icon: 'add_circle', color: '#6366f1', category: 'Werkzeuge',
      description: 'Widget-Button auf der Startseite, der eine globale Variable hochzählt.',
      variables: [{ name: 'zaehler', type: 'integer', value: 0 }],
      triggers: [['widget', { label: 'Zählen', icon: 'add', color: '#6366f1' }]],
      actions: [
        ['set_variable', { var: 'g:zaehler', op: 'inc', amount: 1 }],
        ['toast', { text: 'Zähler: {v=zaehler}' }],
      ],
    },
    {
      id: 'dice', name: 'Würfeln', icon: 'casino', color: '#db2777', category: 'Werkzeuge',
      description: 'Würfelt eine Zahl von 1 bis 6 und sagt sie an. Nutzt eine lokale Variable.',
      localVars: [{ name: 'wurf', type: 'integer', value: 0 }],
      triggers: [['widget', { label: 'Würfeln', icon: 'casino', color: '#db2777' }]],
      actions: [
        ['set_variable', { var: 'l:wurf', op: 'random', min: 1, max: 6 }],
        ['toast', { text: 'Du hast eine {lv=wurf} gewürfelt', duration: 'long' }],
        ['speak', { text: 'Du hast eine {lv=wurf} gewürfelt.' }],
      ],
    },
    {
      id: 'pomodoro', name: 'Pomodoro-Timer', icon: 'timer', color: '#ff6d3a', category: 'Produktivität',
      description: '4 Runden à 25 Minuten Fokus und 5 Minuten Pause – Beispiel für Schleifen und Warten.',
      triggers: [['widget', { label: 'Pomodoro', icon: 'timer', color: '#ff6d3a' }]],
      actions: [
        ['wake_lock', { state: 'on' }],
        ['loop', { mode: 'count', count: 4, conditions: [], logic: 'and' }],
        ['notification', { title: 'Fokus {iteration}/4', text: '25 Minuten konzentriert arbeiten.' }],
        ['wait', { value: 25, unit: 'min' }],
        ['play_sound', { sound: 'chime', volume: 70 }],
        ['notification', { title: 'Pause', text: '5 Minuten durchatmen.' }],
        ['wait', { value: 5, unit: 'min' }],
        ['end_loop', {}],
        ['wake_lock', { state: 'off' }],
        ['speak', { text: 'Pomodoro abgeschlossen. Gut gemacht!' }],
      ],
    },
    {
      id: 'greeting', name: 'Begrüßung beim Start', icon: 'waving_hand', color: '#f5a524', category: 'Alltag',
      description: 'Begrüßt dich beim Öffnen passend zur Tageszeit – Beispiel für Wenn / Sonst wenn / Sonst.',
      triggers: [['app_launch', {}]],
      actions: [
        ['if', { conditions: [C('time_range', { from: '05:00', to: '12:00' })], logic: 'and' }],
        ['toast', { text: 'Guten Morgen!' }],
        ['else_if', { conditions: [C('time_range', { from: '12:00', to: '18:00' })], logic: 'and' }],
        ['toast', { text: 'Guten Tag!' }],
        ['else', {}],
        ['toast', { text: 'Guten Abend!' }],
        ['end_if', {}],
      ],
    },
    {
      id: 'evening', name: 'Feierabend', icon: 'directions_car', color: '#2f7de1', category: 'Alltag',
      description: 'Fragt werktags um 17:00 Uhr nach dem Feierabend und startet bei „Ja“ die Navigation nach Hause.',
      triggers: [['time', { time: '17:00', days: DAYS_WORK }]],
      actions: [
        ['confirm_dialog', { title: 'Feierabend?', message: 'Navigation nach Hause starten?', yes: 'Los geht’s', no: 'Noch nicht', stopOnNo: true }],
        ['navigate', { dest: 'Zuhause', mode: 'driving' }],
      ],
    },
    {
      id: 'sunset', name: 'Sonnenuntergang', icon: 'wb_twilight', color: '#8b5cf6', category: 'Alltag',
      description: 'Benachrichtigt 15 Minuten vor Sonnenuntergang. Standort in den Einstellungen hinterlegen.',
      triggers: [['sun', { event: 'sunset', offset: -15 }]],
      actions: [['notification', { title: 'Bald Sonnenuntergang', text: 'Um {time} Uhr – noch 15 Minuten Tageslicht.' }]],
    },
    {
      id: 'webcheck', name: 'Website-Check', icon: 'http', color: '#0ea5a4', category: 'Werkzeuge',
      description: 'Prüft per HTTP-Anfrage, ob eine Website erreichbar ist, und meldet das Ergebnis.',
      localVars: [{ name: 'status', type: 'integer', value: 0 }],
      triggers: [['widget', { label: 'Web-Check', icon: 'wifi', color: '#0ea5a4' }]],
      actions: [
        ['http_request', { method: 'GET', url: 'https://httpbin.org/status/200', statusVar: 'l:status', timeout: 15 }],
        ['if', { conditions: [C('variable', { var: 'l:status', op: 'eq', value: '200' })], logic: 'and' }],
        ['toast', { text: 'Website erreichbar (Status {lv=status})' }],
        ['else', {}],
        ['notification', { title: 'Website nicht erreichbar', text: 'Status: {lv=status}' }],
        ['end_if', {}],
      ],
    },
    {
      id: 'home', name: 'Ankunft zu Hause', icon: 'home', color: '#2ea05a', category: 'Standort',
      description: 'Begrüßt dich, wenn du nach Hause kommst. Bitte den Ort im Auslöser festlegen.',
      triggers: [['geofence', { event: 'enter', place: { name: 'Zuhause', lat: '', lon: '', radius: 150 } }]],
      actions: [['speak', { text: 'Willkommen zu Hause!' }], ['toast', { text: 'Willkommen zu Hause' }]],
    },
  ];

  function build(kind, [type, params, extra]) {
    const item = MS.catalog.create(kind, type);
    Object.assign(item.params, MS.util.clone(params || {}));
    if (item.params.conditions) item.params.conditions = item.params.conditions.map((c) => build('constraint', c.slice(1)));
    return Object.assign(item, extra || {});
  }

  MS.templates = {
    list,
    /** Erstellt ein neues Makro aus einer Vorlage und legt fehlende globale Variablen an. */
    instantiate(tpl) {
      for (const v of tpl.variables || []) {
        if (!MS.store.state.variables.some((x) => x.name === v.name)) MS.store.state.variables.push(MS.util.clone(v));
      }
      MS.store.ensureCategory(tpl.category);
      return {
        id: MS.util.uid(),
        name: tpl.name,
        description: tpl.description,
        category: tpl.category || 'Allgemein',
        enabled: true,
        triggers: (tpl.triggers || []).map((t) => build('trigger', t)),
        actions: (tpl.actions || []).map((a) => build('action', a)),
        constraints: (tpl.constraints || []).map((c) => build('constraint', c)),
        constraintLogic: 'and',
        localVars: MS.util.clone(tpl.localVars || []),
        created: Date.now(),
      };
    },
  };
})();
