/* Makro Studio – Katalog aller Auslöser, Aktionen und Bedingungen.
 *
 * Jeder Eintrag beschreibt seine Parameter (für den Konfigurationsdialog),
 * eine Kurzbeschreibung (describe) und sein Verhalten:
 *   Auslöser:    start(params, fire, instanz) → Stopp-Funktion
 *   Aktionen:    async run(ctx, params)
 *   Bedingungen: check(ctx, params) → boolean
 */
'use strict';
(function () {
  const MS = window.MS;
  const { fmtTime, atTime, crossed, sleep, uid } = MS.util;
  const M = (text, ctx) => MS.magic.apply(text, ctx);

  const triggers = {}, actions = {}, constraints = {};
  const def = (map, kind) => (type, d) => (map[type] = Object.assign({ type, kind, params: [] }, d));
  const T = def(triggers, 'trigger'), A = def(actions, 'action'), C = def(constraints, 'constraint');

  // ------------------------------------------------------------ Optionen
  const DAY_OPTIONS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];
  const MONTH_OPTIONS = MS.util.MONTHS.map((m, i) => [i, m.slice(0, 3)]);
  const MONTHDAY_OPTIONS = Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]);
  const UNIT_MS = { ms: 1, s: 1000, min: 60000, h: 3600000 };
  const UNIT_OPTIONS = [['ms', 'Millisekunden'], ['s', 'Sekunden'], ['min', 'Minuten'], ['h', 'Stunden']];
  const unitLabel = (u) => ({ ms: 'ms', s: 's', min: 'min', h: 'h' })[u] || u;
  const opt = (options, v) => (options.find((o) => o[0] === v) || [, v])[1];

  function daysText(days) {
    if (!days || !days.length) return 'nie';
    if (days.length === 7) return 'täglich';
    const sorted = DAY_OPTIONS.filter(([d]) => days.includes(d));
    const key = sorted.map(([d]) => d).join();
    if (key === '1,2,3,4,5') return 'Mo–Fr';
    if (key === '6,0') return 'Wochenende';
    return sorted.map(([, l]) => l).join(', ');
  }
  const listText = (vals, options) => (vals && vals.length ? options.filter(([v]) => vals.includes(v)).map(([, l]) => l).join(', ') : 'keine');
  const varName = (ref) => MS.vars.label(ref);
  const macroName = (id) => {
    if (id === '__this') return 'dieses Makro';
    const m = MS.store.macro(id);
    return m ? `„${m.name || 'Unbenannt'}“` : '(fehlt)';
  };
  const condText = (p) => {
    const n = (p.conditions || []).length;
    if (!n) return 'immer wahr';
    const parts = p.conditions.map((c) => {
      const d = constraints[c.type];
      return (c.invert ? 'NICHT ' : '') + (d ? d.describe ? d.describe(c.params || {}) : d.name : c.type);
    });
    return parts.join(p.logic === 'or' ? ' ODER ' : ' UND ');
  };
  const condField = { key: 'conditions', label: 'Bedingungen', type: 'conditions', default: [] };
  const logicField = { key: 'logic', label: 'Verknüpfung', type: 'select', options: [['and', 'UND – alle müssen erfüllt sein'], ['or', 'ODER – eine reicht']], default: 'and' };

  // ================================================================ AUSLÖSER
  const TRIGGER_CATS = [
    { id: 'datetime', name: 'Datum & Uhrzeit', icon: 'schedule' },
    { id: 'power', name: 'Akku & Strom', icon: 'battery_charging_full' },
    { id: 'connectivity', name: 'Konnektivität', icon: 'wifi' },
    { id: 'device', name: 'Geräteereignisse', icon: 'smartphone' },
    { id: 'sensors', name: 'Sensoren', icon: 'sensors' },
    { id: 'location', name: 'Standort', icon: 'location_on' },
    { id: 'app', name: 'Makro Studio', icon: 'bolt' },
  ];
  const hasBattery = () => 'getBattery' in navigator;
  const hasMotion = () => 'DeviceMotionEvent' in window;
  const hasGeo = () => 'geolocation' in navigator;

  T('time', {
    name: 'Tageszeit', icon: 'schedule', cat: 'datetime',
    help: 'Löst zu einer festen Uhrzeit an den gewählten Wochentagen aus (wie ein Wecker).',
    params: [
      { key: 'time', label: 'Uhrzeit', type: 'time', default: '08:00' },
      { key: 'days', label: 'Wochentage', type: 'chips', options: DAY_OPTIONS, default: [0, 1, 2, 3, 4, 5, 6] },
    ],
    describe: (p) => `${p.time} · ${daysText(p.days)}`,
    start(p, fire) {
      return MS.bus.on('tick', ({ prev, now }) => {
        if (!(p.days || []).includes(now.getDay())) return;
        if (crossed(prev, atTime(now, p.time), now)) fire({ info: p.time });
      });
    },
  });

  T('interval', {
    name: 'Regelmäßiges Intervall', icon: 'timer', cat: 'datetime',
    help: 'Löst wiederholt im festen Abstand aus, solange die App geöffnet ist.',
    params: [
      { key: 'value', label: 'Alle', type: 'number', min: 1, default: 15 },
      { key: 'unit', label: 'Einheit', type: 'select', options: UNIT_OPTIONS.slice(1), default: 'min' },
    ],
    describe: (p) => `Alle ${p.value} ${unitLabel(p.unit)}`,
    start(p, fire) {
      const ms = Math.max(1000, Number(p.value) * (UNIT_MS[p.unit] || 1000));
      let n = 0;
      const id = setInterval(() => fire({ info: `Durchlauf ${++n}` }), ms);
      return () => clearInterval(id);
    },
  });

  T('sun', {
    name: 'Sonnenaufgang/-untergang', icon: 'wb_twilight', cat: 'datetime',
    help: 'Löst bei Sonnenauf- oder -untergang aus. Der Standort kommt aus den Einstellungen oder der letzten bekannten Position.',
    params: [
      { key: 'event', label: 'Ereignis', type: 'select', options: [['sunrise', 'Sonnenaufgang'], ['sunset', 'Sonnenuntergang']], default: 'sunset' },
      { key: 'offset', label: 'Versatz in Minuten (negativ = vorher)', type: 'number', min: -720, max: 720, default: 0 },
    ],
    describe: (p) => {
      const ev = p.event === 'sunrise' ? 'Sonnenaufgang' : 'Sonnenuntergang';
      const o = Number(p.offset) || 0;
      return o ? `${ev} ${o > 0 ? '+' : '−'}${Math.abs(o)} min` : ev;
    },
    start(p, fire) {
      let key = '', target = null;
      return MS.bus.on('tick', ({ prev, now }) => {
        const loc = MS.geo.home();
        if (!loc) return;
        const k = now.toDateString() + loc.lat.toFixed(2) + loc.lon.toFixed(2);
        if (k !== key) {
          key = k;
          const t = MS.geo.sunTimes(now, loc.lat, loc.lon)[p.event];
          target = isNaN(t) ? null : new Date(t.getTime() + (Number(p.offset) || 0) * 60000);
        }
        if (target && crossed(prev, target, now)) fire({ info: fmtTime(target) });
      });
    },
  });

  T('day_of_month', {
    name: 'Tag im Monat', icon: 'calendar_month', cat: 'datetime',
    help: 'Löst an einem bestimmten Tag im Monat zur angegebenen Uhrzeit aus.',
    params: [
      { key: 'day', label: 'Tag', type: 'select', options: [...MONTHDAY_OPTIONS.map(([v, l]) => [String(v), l + '.']), ['last', 'Letzter Tag']], default: '1' },
      { key: 'time', label: 'Uhrzeit', type: 'time', default: '09:00' },
    ],
    describe: (p) => `${p.day === 'last' ? 'Letzter Tag' : p.day + '.'} des Monats, ${p.time}`,
    start(p, fire) {
      return MS.bus.on('tick', ({ prev, now }) => {
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const day = p.day === 'last' ? last : Number(p.day);
        if (now.getDate() === day && crossed(prev, atTime(now, p.time), now)) fire({ info: `${day}. ${p.time}` });
      });
    },
  });

  T('battery_level', {
    name: 'Akkustand', icon: 'battery_3_bar', cat: 'power', supported: hasBattery,
    help: 'Löst aus, wenn der Akkustand einen Grenzwert unter- oder überschreitet.',
    params: [
      { key: 'dir', label: 'Wenn der Akku', type: 'select', options: [['below', 'unter den Wert fällt'], ['above', 'über den Wert steigt']], default: 'below' },
      { key: 'level', label: 'Grenzwert in %', type: 'number', min: 1, max: 100, default: 20 },
    ],
    describe: (p) => `${p.dir === 'below' ? 'Fällt unter' : 'Steigt über'} ${p.level} %`,
    start(p, fire) {
      const L = Number(p.level);
      return MS.bus.on('battery', ({ level, prevLevel }) => {
        if (prevLevel == null || level === prevLevel) return;
        const hit = p.dir === 'below' ? prevLevel >= L && level < L : prevLevel <= L && level > L;
        if (hit) fire({ info: level + ' %' });
      });
    },
  });

  T('power', {
    name: 'Stromanschluss', icon: 'power', cat: 'power', supported: hasBattery,
    help: 'Löst aus, wenn das Ladegerät angeschlossen oder getrennt wird.',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: [['connected', 'Angeschlossen'], ['disconnected', 'Getrennt'], ['any', 'Angeschlossen oder getrennt']], default: 'connected' }],
    describe: (p) => ({ connected: 'Angeschlossen', disconnected: 'Getrennt', any: 'Angeschlossen/getrennt' })[p.state],
    start(p, fire) {
      return MS.bus.on('battery', ({ charging, prevCharging }) => {
        if (prevCharging == null || charging === prevCharging) return;
        if (p.state === 'any' || (p.state === 'connected') === charging) fire({ info: charging ? 'angeschlossen' : 'getrennt' });
      });
    },
  });

  T('connectivity', {
    name: 'Netzwerkverbindung', icon: 'wifi', cat: 'connectivity',
    help: 'Löst aus, wenn die Internetverbindung hergestellt wird oder verloren geht.',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: [['online', 'Verbunden (online)'], ['offline', 'Getrennt (offline)'], ['any', 'Jede Änderung']], default: 'offline' }],
    describe: (p) => ({ online: 'Verbunden', offline: 'Verbindung verloren', any: 'Jede Änderung' })[p.state],
    start(p, fire) {
      return MS.bus.on('connectivity', ({ online }) => {
        if (p.state === 'any' || (p.state === 'online') === online) fire({ info: online ? 'online' : 'offline' });
      });
    },
  });

  T('app_launch', {
    name: 'Makro Studio gestartet', icon: 'rocket_launch', cat: 'device',
    help: 'Löst einmal aus, wenn die App geöffnet wird (vergleichbar mit „Gerät gestartet“).',
    describe: () => 'Beim Öffnen der App',
    start(p, fire) { return MS.bus.on('app-start', () => fire({ info: 'App gestartet' })); },
  });

  T('visibility', {
    name: 'App sichtbar/verborgen', icon: 'visibility', cat: 'device',
    help: 'Löst aus, wenn die App in den Vordergrund kommt oder verlassen wird (vergleichbar mit „Bildschirm an/aus“).',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: [['visible', 'App im Vordergrund'], ['hidden', 'App verlassen']], default: 'visible' }],
    describe: (p) => (p.state === 'visible' ? 'App im Vordergrund' : 'App verlassen'),
    start(p, fire) {
      return MS.bus.on('visibility', ({ visible }) => {
        if ((p.state === 'visible') === visible) fire({ info: visible ? 'sichtbar' : 'verborgen' });
      });
    },
  });

  T('orientation', {
    name: 'Bildschirmausrichtung', icon: 'screen_rotation', cat: 'device',
    help: 'Löst aus, wenn das Gerät gedreht wird.',
    params: [{ key: 'state', label: 'Ausrichtung', type: 'select', options: [['portrait', 'Hochformat'], ['landscape', 'Querformat']], default: 'landscape' }],
    describe: (p) => (p.state === 'portrait' ? 'Hochformat' : 'Querformat'),
    start(p, fire) {
      return MS.bus.on('orientation', ({ orientation }) => {
        if (orientation === p.state) fire({ info: orientation === 'portrait' ? 'Hochformat' : 'Querformat' });
      });
    },
  });

  T('shake', {
    name: 'Gerät schütteln', icon: 'vibration', cat: 'sensors', supported: hasMotion,
    help: 'Löst aus, wenn das Gerät geschüttelt wird. Auf iOS muss der Bewegungssensor in den Einstellungen freigegeben werden.',
    params: [{ key: 'sensitivity', label: 'Empfindlichkeit', type: 'select', options: [['high', 'Hoch'], ['medium', 'Mittel'], ['low', 'Niedrig']], default: 'medium' }],
    describe: (p) => 'Empfindlichkeit: ' + ({ high: 'hoch', medium: 'mittel', low: 'niedrig' })[p.sensitivity],
    start(p, fire) {
      const threshold = { high: 14, medium: 22, low: 32 }[p.sensitivity] || 22;
      let last = 0;
      return MS.bus.on('shake', ({ force }) => {
        if (force < threshold || Date.now() - last < 1500) return;
        last = Date.now();
        fire({ info: 'Stärke ' + force.toFixed(0) });
      });
    },
  });

  T('flip', {
    name: 'Gerät umdrehen', icon: 'flip', cat: 'sensors', supported: hasMotion,
    help: 'Löst aus, wenn das Gerät mit dem Display nach unten oder oben gelegt wird.',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: [['down', 'Display nach unten'], ['up', 'Display nach oben'], ['any', 'Beides']], default: 'down' }],
    describe: (p) => ({ down: 'Display nach unten', up: 'Display nach oben', any: 'Umgedreht' })[p.state],
    start(p, fire) {
      return MS.bus.on('flip', ({ faceDown }) => {
        if (p.state === 'any' || (p.state === 'down') === faceDown) fire({ info: faceDown ? 'nach unten' : 'nach oben' });
      });
    },
  });

  T('geofence', {
    name: 'Geofence (Ort betreten/verlassen)', icon: 'share_location', cat: 'location', supported: hasGeo,
    help: 'Löst aus, wenn du einen Bereich um einen Ort betrittst oder verlässt. Die App benötigt dafür die Standortfreigabe.',
    params: [
      { key: 'event', label: 'Ereignis', type: 'select', options: [['enter', 'Bereich betreten'], ['exit', 'Bereich verlassen']], default: 'enter' },
      { key: 'place', label: 'Ort', type: 'location', default: { name: '', lat: '', lon: '', radius: 150 } },
    ],
    describe: (p) => `${p.event === 'enter' ? 'Betreten' : 'Verlassen'}: ${placeText(p.place)}`,
    start(p, fire) {
      const pl = p.place || {};
      const lat = parseFloat(pl.lat), lon = parseFloat(pl.lon), r = Number(pl.radius) || 150;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return () => {};
      let inside = null;
      const release = MS.device.requireLocation();
      const off = MS.bus.on('position', (pos) => {
        const now = MS.geo.distance(pos.lat, pos.lon, lat, lon) <= r;
        if (inside !== null && now !== inside && (p.event === 'enter') === now) fire({ info: placeText(pl) });
        inside = now;
      });
      return () => { off(); release(); };
    },
  });
  function placeText(pl) {
    if (!pl) return '–';
    const lat = parseFloat(pl.lat), lon = parseFloat(pl.lon);
    const coords = Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : 'kein Ort';
    return `${pl.name || coords} (${pl.radius || 150} m)`;
  }

  T('widget', {
    name: 'Widget-Button', icon: 'touch_app', cat: 'app',
    help: 'Zeigt einen Button auf der Startseite. Ein Tipp darauf startet das Makro.',
    params: [
      { key: 'label', label: 'Beschriftung', type: 'text', default: 'Start', required: true },
      { key: 'icon', label: 'Symbol', type: 'icon', default: 'play_arrow' },
      { key: 'color', label: 'Farbe', type: 'color', default: '#2f7de1' },
    ],
    describe: (p) => `„${p.label}“`,
    start(p, fire, inst) {
      return MS.bus.on('widget', (id) => { if (id === inst.id) fire({ info: p.label }); });
    },
  });

  T('shortcut', {
    name: 'Verknüpfung (URL)', icon: 'link', cat: 'app',
    help: 'Startet das Makro beim Aufruf einer eigenen Adresse – z. B. als Lesezeichen oder Homescreen-Verknüpfung.',
    params: [{ type: 'info', text: (p, ctx) => `Adresse: ${location.origin}${location.pathname}#/run/${ctx.item ? ctx.item.id : '…'}` }],
    describe: () => 'Über eigene Adresse',
    start(p, fire, inst) {
      return MS.bus.on('shortcut', (id) => { if (id === inst.id) fire({ info: 'Verknüpfung' }); });
    },
  });

  T('variable_change', {
    name: 'Variable geändert', icon: 'data_object', cat: 'app',
    help: 'Löst aus, wenn sich der Wert einer globalen Variable ändert.',
    params: [
      { key: 'var', label: 'Variable', type: 'var', scope: 'global', required: true },
      { key: 'op', label: 'Wenn neuer Wert', type: 'select', options: [['any', 'beliebig'], ...MS.COMPARE_OPS], default: 'any' },
      { key: 'value', label: 'Vergleichswert', type: 'text', magic: true, default: '', showIf: (p) => p.op !== 'any' },
    ],
    describe: (p) => `${varName(p.var)}${p.op === 'any' ? ' geändert' : ` ${opt(MS.COMPARE_OPS, p.op)} ${p.value}`}`,
    start(p, fire) {
      const ref = MS.vars.parseRef(p.var);
      if (!ref) return () => {};
      return MS.bus.on('var-changed', (e) => {
        if (e.scope !== 'g' || e.name !== ref.name) return;
        if (p.op === 'any' || MS.compare(e.value, p.op, M(p.value))) fire({ info: `${e.name} = ${e.value}` });
      });
    },
  });

  T('empty', {
    name: 'Leerer Auslöser', icon: 'radio_button_unchecked', cat: 'app',
    help: 'Löst nie selbst aus. Das Makro kann über „Makro ausführen“ oder manuell gestartet werden.',
    describe: () => 'Nur manuell / durch andere Makros',
    start: () => () => {},
  });

  // ================================================================= AKTIONEN
  const ACTION_CATS = [
    { id: 'notify', name: 'Benachrichtigungen', icon: 'notifications' },
    { id: 'audio', name: 'Ton & Sprache', icon: 'volume_up' },
    { id: 'device', name: 'Geräteaktionen', icon: 'smartphone' },
    { id: 'apps', name: 'Apps & Kommunikation', icon: 'apps' },
    { id: 'web', name: 'Web & Standort', icon: 'language' },
    { id: 'dialogs', name: 'Dialoge & Eingaben', icon: 'chat' },
    { id: 'vars', name: 'Variablen & Text', icon: 'data_object' },
    { id: 'flow', name: 'Bedingungen & Schleifen', icon: 'alt_route' },
    { id: 'macro', name: 'Makro Studio', icon: 'bolt' },
  ];
  const FLOW = new Set(['if', 'else_if', 'else', 'end_if', 'loop', 'end_loop', 'break_loop', 'continue_loop']);

  // --- Benachrichtigungen
  async function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: uid() });
        else new Notification(title, { body, icon: 'icons/icon-192.png' });
        return;
      } catch (e) { /* Fallback unten */ }
    }
    MS.ui.toast(`${title}${body ? ' – ' + body : ''}`, 5000, 'notifications');
  }

  A('notification', {
    name: 'Benachrichtigung anzeigen', icon: 'notifications_active', cat: 'notify',
    help: 'Zeigt eine System-Benachrichtigung. Ohne Berechtigung erscheint eine Einblendung in der App.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: 'Makro Studio' },
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: '' },
    ],
    describe: (p) => p.title + (p.text ? ': ' + p.text : ''),
    run: (ctx, p) => notify(M(p.title, ctx), M(p.text, ctx)),
  });

  A('toast', {
    name: 'Popup-Nachricht', icon: 'chat_bubble', cat: 'notify',
    help: 'Zeigt kurz eine Einblendung am unteren Bildschirmrand (Toast).',
    params: [
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: 'Hallo!', required: true },
      { key: 'duration', label: 'Dauer', type: 'select', options: [['short', 'Kurz (2 s)'], ['long', 'Lang (5 s)']], default: 'short' },
    ],
    describe: (p) => p.text,
    run: (ctx, p) => MS.ui.toast(M(p.text, ctx), p.duration === 'long' ? 5000 : 2200),
  });

  A('dialog_message', {
    name: 'Dialog anzeigen', icon: 'web_asset', cat: 'notify',
    help: 'Zeigt einen Dialog mit Titel und Text. Optional wartet das Makro, bis er geschlossen wird.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: 'Hinweis' },
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: '' },
      { key: 'button', label: 'Button-Text', type: 'text', default: 'OK' },
      { key: 'wait', label: 'Warten, bis geschlossen', type: 'bool', default: true },
    ],
    describe: (p) => p.title + (p.text ? ': ' + p.text : ''),
    async run(ctx, p) {
      const pr = MS.ui.alert(M(p.title, ctx), M(p.text, ctx), p.button || 'OK');
      if (p.wait) await pr;
    },
  });

  A('flash_screen', {
    name: 'Bildschirm blinken', icon: 'flare', cat: 'notify',
    help: 'Lässt den Bildschirm in einer Farbe aufblinken.',
    params: [
      { key: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
      { key: 'times', label: 'Anzahl', type: 'number', min: 1, max: 20, default: 3 },
    ],
    describe: (p) => `${p.times}× blinken`,
    async run(ctx, p) {
      const el = document.createElement('div');
      el.className = 'flash-overlay';
      el.style.background = p.color;
      document.body.append(el);
      for (let i = 0; i < Number(p.times); i++) {
        if (ctx.token.cancelled) break;
        el.style.opacity = '0.9';
        await sleep(160);
        el.style.opacity = '0';
        await sleep(160);
      }
      el.remove();
    },
  });

  // --- Ton & Sprache
  A('speak', {
    name: 'Text sprechen', icon: 'record_voice_over', cat: 'audio', supported: () => 'speechSynthesis' in window,
    help: 'Liest einen Text mit der Sprachausgabe des Geräts vor.',
    params: [
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: 'Es ist {time} Uhr.', required: true },
      { key: 'lang', label: 'Sprache', type: 'select', options: [['de-DE', 'Deutsch'], ['en-US', 'Englisch (US)'], ['en-GB', 'Englisch (UK)'], ['fr-FR', 'Französisch'], ['es-ES', 'Spanisch'], ['it-IT', 'Italienisch'], ['sr-RS', 'Serbisch']], default: 'de-DE' },
      { key: 'rate', label: 'Geschwindigkeit', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'pitch', label: 'Tonhöhe', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'wait', label: 'Warten, bis fertig gesprochen', type: 'bool', default: true },
    ],
    describe: (p) => p.text,
    run(ctx, p) {
      return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) throw new Error('Sprachausgabe nicht verfügbar');
        const u = new SpeechSynthesisUtterance(M(p.text, ctx));
        u.lang = p.lang;
        u.rate = Number(p.rate) || 1;
        u.pitch = Number(p.pitch) || 1;
        const voice = speechSynthesis.getVoices().find((v) => v.lang === p.lang);
        if (voice) u.voice = voice;
        u.onend = u.onerror = () => resolve();
        speechSynthesis.speak(u);
        if (!p.wait) resolve();
      });
    },
  });

  let audioCtx = null;
  const SOUNDS = {
    beep: { wave: 'sine', seq: [[880, 220]] },
    double: { wave: 'sine', seq: [[880, 140, 90], [880, 140]] },
    chime: { wave: 'triangle', seq: [[660, 220], [880, 220], [1320, 420]] },
    success: { wave: 'sine', seq: [[523, 120], [659, 120], [784, 260]] },
    error: { wave: 'sawtooth', seq: [[320, 220, 60], [220, 420]] },
    alarm: { wave: 'square', seq: Array.from({ length: 8 }, (_, i) => [i % 2 ? 700 : 1000, 200, 40]) },
  };
  async function playPreset(name, volume) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Audio nicht verfügbar');
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
    const snd = SOUNDS[name] || SOUNDS.beep;
    let t = audioCtx.currentTime + 0.02;
    for (const [f, d, g = 30] of snd.seq) {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      const dur = d / 1000;
      osc.type = snd.wave;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.01);
      gain.gain.setValueAtTime(volume, t + dur - 0.03);
      gain.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + g / 1000;
    }
    return (t - audioCtx.currentTime) * 1000;
  }
  const SOUND_OPTIONS = [['beep', 'Piep'], ['double', 'Doppel-Piep'], ['chime', 'Glocke'], ['success', 'Erfolg'], ['error', 'Fehler'], ['alarm', 'Alarm'], ['url', 'Audiodatei (URL)']];
  A('play_sound', {
    name: 'Ton abspielen', icon: 'music_note', cat: 'audio',
    help: 'Spielt einen eingebauten Ton oder eine Audiodatei (URL) ab.',
    params: [
      { key: 'sound', label: 'Ton', type: 'select', options: SOUND_OPTIONS, default: 'chime' },
      { key: 'url', label: 'Audio-URL', type: 'text', magic: true, default: '', showIf: (p) => p.sound === 'url' },
      { key: 'volume', label: 'Lautstärke (0–100)', type: 'number', min: 0, max: 100, default: 70 },
      { key: 'wait', label: 'Warten, bis abgespielt', type: 'bool', default: false },
    ],
    describe: (p) => (p.sound === 'url' ? p.url : opt(SOUND_OPTIONS, p.sound)) + ` · ${p.volume} %`,
    async run(ctx, p) {
      const vol = Math.max(0, Math.min(100, Number(p.volume))) / 100;
      if (p.sound === 'url') {
        const audio = new Audio(M(p.url, ctx));
        audio.volume = vol;
        await audio.play();
        if (p.wait) await new Promise((r) => { audio.onended = audio.onerror = r; });
        return;
      }
      const ms = await playPreset(p.sound, vol * 0.5);
      if (p.wait) await sleep(ms);
    },
  });

  A('vibrate', {
    name: 'Vibrieren', icon: 'vibration', cat: 'audio', supported: () => 'vibrate' in navigator,
    help: 'Lässt das Gerät mit einem Muster vibrieren (nur auf Geräten mit Vibrationsmotor).',
    params: [
      { key: 'pattern', label: 'Muster', type: 'select', options: [['short', 'Kurz'], ['long', 'Lang'], ['double', 'Doppelt'], ['heartbeat', 'Herzschlag'], ['sos', 'SOS'], ['custom', 'Eigenes Muster']], default: 'short' },
      { key: 'custom', label: 'Muster in ms (Vibration, Pause, …)', type: 'text', default: '200,100,200', showIf: (p) => p.pattern === 'custom' },
    ],
    describe: (p) => (p.pattern === 'custom' ? p.custom : opt(actions.vibrate.params[0].options, p.pattern)),
    run(ctx, p) {
      const P = { short: [200], long: [800], double: [150, 100, 150], heartbeat: [100, 120, 100, 600, 100, 120, 100], sos: [100, 80, 100, 80, 100, 250, 300, 80, 300, 80, 300, 250, 100, 80, 100, 80, 100] };
      const pattern = p.pattern === 'custom' ? String(p.custom).split(/[,;\s]+/).map(Number).filter((n) => n >= 0) : P[p.pattern];
      if (!navigator.vibrate || !navigator.vibrate(pattern)) throw new Error('Vibration wird auf diesem Gerät nicht unterstützt');
    },
  });

  // --- Geräteaktionen
  let torchTrack = null;
  async function setTorch(on) {
    if (on) {
      if (torchTrack) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Kamera nicht verfügbar');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities && track.getCapabilities()) || {};
      if (!caps.torch) { track.stop(); throw new Error('Taschenlampe wird von diesem Gerät/Browser nicht unterstützt'); }
      await track.applyConstraints({ advanced: [{ torch: true }] });
      torchTrack = track;
    } else if (torchTrack) {
      torchTrack.stop();
      torchTrack = null;
    }
  }
  const STATE3 = [['on', 'Einschalten'], ['off', 'Ausschalten'], ['toggle', 'Umschalten']];
  A('torch', {
    name: 'Taschenlampe', icon: 'flashlight_on', cat: 'device',
    help: 'Schaltet das Kameralicht ein oder aus (Android/Chrome, benötigt Kamerafreigabe).',
    params: [{ key: 'state', label: 'Aktion', type: 'select', options: STATE3, default: 'toggle' }],
    describe: (p) => opt(STATE3, p.state),
    run: (ctx, p) => setTorch(p.state === 'toggle' ? !torchTrack : p.state === 'on'),
  });

  let wakeLock = null, wantWake = false;
  async function setWake(on) {
    wantWake = on;
    if (on) {
      if (wakeLock) return;
      if (!navigator.wakeLock) throw new Error('Wach halten wird nicht unterstützt');
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantWake && !wakeLock) setWake(true).catch(() => {});
  });
  A('wake_lock', {
    name: 'Bildschirm wach halten', icon: 'light_mode', cat: 'device', supported: () => 'wakeLock' in navigator,
    help: 'Verhindert, dass sich der Bildschirm automatisch ausschaltet.',
    params: [{ key: 'state', label: 'Aktion', type: 'select', options: STATE3, default: 'on' }],
    describe: (p) => opt(STATE3, p.state),
    run: (ctx, p) => setWake(p.state === 'toggle' ? !wantWake : p.state === 'on'),
  });

  A('fullscreen', {
    name: 'Vollbild', icon: 'fullscreen', cat: 'device',
    help: 'Schaltet den Vollbildmodus der App um. Browser erlauben das teils nur nach einem Tipp.',
    params: [{ key: 'state', label: 'Aktion', type: 'select', options: STATE3, default: 'toggle' }],
    describe: (p) => opt(STATE3, p.state),
    async run(ctx, p) {
      const on = p.state === 'toggle' ? !document.fullscreenElement : p.state === 'on';
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    },
  });

  A('clipboard', {
    name: 'In Zwischenablage kopieren', icon: 'content_paste', cat: 'device',
    help: 'Legt einen Text in die Zwischenablage.',
    params: [{ key: 'text', label: 'Text', type: 'textarea', magic: true, default: '', required: true }],
    describe: (p) => p.text,
    async run(ctx, p) {
      if (!navigator.clipboard) throw new Error('Zwischenablage nicht verfügbar');
      await navigator.clipboard.writeText(M(p.text, ctx));
    },
  });

  A('share', {
    name: 'Teilen', icon: 'share', cat: 'device',
    help: 'Öffnet das Teilen-Menü des Geräts mit Text und/oder Link.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: '' },
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: '' },
      { key: 'url', label: 'Link', type: 'text', magic: true, default: '' },
    ],
    describe: (p) => p.text || p.url || p.title,
    async run(ctx, p) {
      const data = { title: M(p.title, ctx), text: M(p.text, ctx) };
      const url = M(p.url, ctx);
      if (url) data.url = url;
      if (!navigator.share) {
        await navigator.clipboard.writeText([data.text, url].filter(Boolean).join(' '));
        MS.ui.toast('Teilen nicht verfügbar – in Zwischenablage kopiert');
        return;
      }
      await navigator.share(data);
    },
  });

  // --- Apps & Kommunikation
  function openLink(url, newTab) {
    if (newTab) {
      const w = window.open(url, '_blank', 'noopener');
      if (!w) location.href = url;
    } else location.href = url;
  }
  A('open_url', {
    name: 'Website öffnen', icon: 'open_in_browser', cat: 'apps',
    help: 'Öffnet eine Adresse im Browser. App-Links (z. B. spotify:, whatsapp:) öffnen die passende App.',
    params: [
      { key: 'url', label: 'Adresse', type: 'text', magic: true, default: 'https://', required: true },
      { key: 'newTab', label: 'In neuem Tab öffnen', type: 'bool', default: true },
    ],
    describe: (p) => p.url,
    run: (ctx, p) => openLink(M(p.url, ctx), p.newTab),
  });
  A('call', {
    name: 'Anrufen', icon: 'call', cat: 'apps',
    help: 'Öffnet die Telefon-App mit der Nummer.',
    params: [{ key: 'number', label: 'Telefonnummer', type: 'text', magic: true, default: '', required: true }],
    describe: (p) => p.number,
    run: (ctx, p) => openLink('tel:' + encodeURIComponent(M(p.number, ctx).replace(/\s/g, '')), false),
  });
  A('sms', {
    name: 'SMS schreiben', icon: 'sms', cat: 'apps',
    help: 'Öffnet die SMS-App mit Empfänger und vorausgefülltem Text.',
    params: [
      { key: 'number', label: 'Empfänger', type: 'text', magic: true, default: '', required: true },
      { key: 'text', label: 'Nachricht', type: 'textarea', magic: true, default: '' },
    ],
    describe: (p) => `${p.number}: ${p.text}`,
    run: (ctx, p) => openLink(`sms:${encodeURIComponent(M(p.number, ctx).replace(/\s/g, ''))}?body=${encodeURIComponent(M(p.text, ctx))}`, false),
  });
  A('email', {
    name: 'E-Mail schreiben', icon: 'mail', cat: 'apps',
    help: 'Öffnet das E-Mail-Programm mit vorausgefüllter Nachricht.',
    params: [
      { key: 'to', label: 'An', type: 'text', magic: true, default: '', required: true },
      { key: 'subject', label: 'Betreff', type: 'text', magic: true, default: '' },
      { key: 'body', label: 'Nachricht', type: 'textarea', magic: true, default: '' },
    ],
    describe: (p) => `${p.to}: ${p.subject}`,
    run: (ctx, p) => openLink(`mailto:${encodeURIComponent(M(p.to, ctx))}?subject=${encodeURIComponent(M(p.subject, ctx))}&body=${encodeURIComponent(M(p.body, ctx))}`, false),
  });
  A('navigate', {
    name: 'Navigation starten', icon: 'directions', cat: 'apps',
    help: 'Öffnet die Kartennavigation zu einem Ziel.',
    params: [
      { key: 'dest', label: 'Ziel (Adresse oder Koordinaten)', type: 'text', magic: true, default: '', required: true },
      { key: 'mode', label: 'Verkehrsmittel', type: 'select', options: [['driving', 'Auto'], ['walking', 'Zu Fuß'], ['bicycling', 'Fahrrad'], ['transit', 'ÖPNV']], default: 'driving' },
    ],
    describe: (p) => p.dest,
    run: (ctx, p) => openLink(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(M(p.dest, ctx))}&travelmode=${p.mode}`, true),
  });

  // --- Web & Standort
  A('http_request', {
    name: 'HTTP-Anfrage', icon: 'http', cat: 'web',
    help: 'Sendet eine HTTP-Anfrage (z. B. an einen Webhook oder eine API) und kann die Antwort in Variablen speichern. Der Server muss CORS erlauben.',
    params: [
      { key: 'method', label: 'Methode', type: 'select', options: [['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE']], default: 'GET' },
      { key: 'url', label: 'URL', type: 'text', magic: true, default: 'https://', required: true },
      { key: 'headers', label: 'Header (eine Zeile pro „Name: Wert“)', type: 'textarea', magic: true, default: '' },
      { key: 'contentType', label: 'Inhaltstyp', type: 'select', options: [['application/json', 'JSON'], ['text/plain', 'Text'], ['application/x-www-form-urlencoded', 'Formular']], default: 'application/json', showIf: (p) => p.method !== 'GET' },
      { key: 'body', label: 'Inhalt (Body)', type: 'textarea', magic: true, default: '', showIf: (p) => p.method !== 'GET' },
      { key: 'timeout', label: 'Zeitlimit (Sekunden)', type: 'number', min: 1, max: 120, default: 20 },
      { key: 'resultVar', label: 'Antwort speichern in', type: 'var', varTypes: ['string'], optional: true },
      { key: 'statusVar', label: 'Statuscode speichern in', type: 'var', varTypes: ['integer', 'decimal', 'string'], optional: true },
    ],
    describe: (p) => `${p.method} ${p.url}`,
    async run(ctx, p) {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), (Number(p.timeout) || 20) * 1000);
      const headers = {};
      M(p.headers, ctx).split('\n').forEach((line) => {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      const init = { method: p.method, headers, signal: ac.signal };
      if (p.method !== 'GET') {
        init.body = M(p.body, ctx);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = p.contentType;
      }
      try {
        const res = await fetch(M(p.url, ctx), init);
        const text = await res.text();
        if (p.resultVar) MS.vars.set(p.resultVar, text, ctx);
        if (p.statusVar) MS.vars.set(p.statusVar, res.status, ctx);
        if (!res.ok) MS.log('warn', `HTTP ${res.status} von ${res.url}`, ctx.macroName);
      } catch (e) {
        if (p.statusVar) MS.vars.set(p.statusVar, 0, ctx);
        throw new Error(e.name === 'AbortError' ? 'Zeitlimit überschritten' : e.message + ' (Netzwerk/CORS)');
      } finally {
        clearTimeout(to);
      }
    },
  });

  A('get_location', {
    name: 'Standort abrufen', icon: 'my_location', cat: 'web', supported: hasGeo,
    help: 'Ermittelt die aktuelle Position. Danach sind {lat} und {lon} verfügbar; optional in Variablen speichern.',
    params: [
      { key: 'latVar', label: 'Breitengrad speichern in', type: 'var', varTypes: ['decimal', 'string'], optional: true },
      { key: 'lonVar', label: 'Längengrad speichern in', type: 'var', varTypes: ['decimal', 'string'], optional: true },
      { key: 'timeout', label: 'Zeitlimit (Sekunden)', type: 'number', min: 1, max: 120, default: 20 },
    ],
    describe: (p) => (p.latVar || p.lonVar ? `→ ${[p.latVar, p.lonVar].filter(Boolean).map(varName).join(', ')}` : 'Für {lat}/{lon}'),
    async run(ctx, p) {
      const pos = await MS.device.getPosition((Number(p.timeout) || 20) * 1000);
      if (p.latVar) MS.vars.set(p.latVar, pos.lat, ctx);
      if (p.lonVar) MS.vars.set(p.lonVar, pos.lon, ctx);
    },
  });

  // --- Dialoge
  const cancelField = { key: 'onCancel', label: 'Bei Abbruch', type: 'select', options: [['continue', 'Makro fortsetzen'], ['stop', 'Makro beenden']], default: 'stop' };
  A('input_dialog', {
    name: 'Texteingabe', icon: 'edit_note', cat: 'dialogs',
    help: 'Fragt einen Text oder eine Zahl ab und speichert sie in einer Variable.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: 'Eingabe' },
      { key: 'message', label: 'Nachricht', type: 'text', magic: true, default: '' },
      { key: 'def', label: 'Vorgabewert', type: 'text', magic: true, default: '' },
      { key: 'inputType', label: 'Eingabetyp', type: 'select', options: [['text', 'Text'], ['number', 'Zahl']], default: 'text' },
      { key: 'var', label: 'Speichern in', type: 'var', required: true },
      cancelField,
    ],
    describe: (p) => `${p.title} → ${varName(p.var)}`,
    async run(ctx, p) {
      const v = await MS.ui.prompt(M(p.title, ctx), M(p.message, ctx), M(p.def, ctx), p.inputType);
      if (v === null) { if (p.onCancel === 'stop') ctx.stop('Eingabe abgebrochen'); return; }
      MS.vars.set(p.var, v, ctx);
    },
  });

  A('options_dialog', {
    name: 'Auswahldialog', icon: 'list', cat: 'dialogs',
    help: 'Zeigt eine Liste von Optionen. Die gewählte Option wird in einer Variable gespeichert.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: 'Bitte wählen' },
      { key: 'options', label: 'Optionen (eine pro Zeile)', type: 'textarea', magic: true, default: 'Option A\nOption B', required: true },
      { key: 'var', label: 'Auswahl speichern in', type: 'var', required: true },
      cancelField,
    ],
    describe: (p) => `${String(p.options).split('\n').filter(Boolean).join(' / ')} → ${varName(p.var)}`,
    async run(ctx, p) {
      const opts = M(p.options, ctx).split('\n').map((s) => s.trim()).filter(Boolean);
      const i = await MS.ui.choose(M(p.title, ctx), opts);
      if (i === null) { if (p.onCancel === 'stop') ctx.stop('Auswahl abgebrochen'); return; }
      MS.vars.set(p.var, opts[i], ctx);
    },
  });

  A('confirm_dialog', {
    name: 'Bestätigungsdialog', icon: 'help', cat: 'dialogs',
    help: 'Stellt eine Ja/Nein-Frage. Das Ergebnis kann gespeichert werden oder das Makro bei „Nein“ beenden.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: 'Fortfahren?' },
      { key: 'message', label: 'Nachricht', type: 'textarea', magic: true, default: '' },
      { key: 'yes', label: 'Text für Ja', type: 'text', default: 'Ja' },
      { key: 'no', label: 'Text für Nein', type: 'text', default: 'Nein' },
      { key: 'var', label: 'Ergebnis speichern in (optional)', type: 'var', varTypes: ['boolean'], optional: true },
      { key: 'stopOnNo', label: 'Bei „Nein“ Makro beenden', type: 'bool', default: true },
    ],
    describe: (p) => p.title + (p.stopOnNo ? ' (Nein = beenden)' : ''),
    async run(ctx, p) {
      const ok = await MS.ui.confirm(M(p.title, ctx), M(p.message, ctx), p.yes || 'Ja', p.no || 'Nein');
      if (p.var) MS.vars.set(p.var, ok, ctx);
      if (!ok && p.stopOnNo) ctx.stop('Mit „Nein“ beantwortet');
    },
  });

  // --- Variablen & Text
  const SETVAR_OPS = [['set', 'Wert setzen'], ['expr', 'Berechnen (Ausdruck)'], ['inc', 'Erhöhen um'], ['dec', 'Verringern um'], ['toggle', 'Umschalten (wahr/falsch)'], ['random', 'Zufallszahl']];
  A('set_variable', {
    name: 'Variable setzen', icon: 'edit', cat: 'vars',
    help: 'Setzt, berechnet oder verändert den Wert einer Variable. Ausdrücke unterstützen + − * / % ^, Klammern und Funktionen wie round(), min(), max(), random().',
    params: [
      { key: 'var', label: 'Variable', type: 'var', required: true },
      { key: 'op', label: 'Vorgang', type: 'select', options: SETVAR_OPS, default: 'set' },
      { key: 'value', label: 'Wert', type: 'text', magic: true, default: '', showIf: (p) => p.op === 'set' },
      { key: 'expr', label: 'Ausdruck, z. B. {v=zaehler} * 2 + 1', type: 'text', magic: true, default: '', showIf: (p) => p.op === 'expr' },
      { key: 'amount', label: 'Betrag', type: 'number', default: 1, showIf: (p) => p.op === 'inc' || p.op === 'dec' },
      { key: 'min', label: 'Minimum', type: 'number', default: 1, showIf: (p) => p.op === 'random' },
      { key: 'max', label: 'Maximum', type: 'number', default: 6, showIf: (p) => p.op === 'random' },
    ],
    describe(p) {
      const n = varName(p.var);
      switch (p.op) {
        case 'set': return `${n} = ${p.value}`;
        case 'expr': return `${n} = ${p.expr}`;
        case 'inc': return `${n} + ${p.amount}`;
        case 'dec': return `${n} − ${p.amount}`;
        case 'toggle': return `${n} umschalten`;
        case 'random': return `${n} = Zufall ${p.min}–${p.max}`;
      }
      return n;
    },
    run(ctx, p) {
      const cur = MS.vars.get(p.var, ctx);
      let v;
      switch (p.op) {
        case 'set': v = M(p.value, ctx); break;
        case 'expr': v = MS.calc(M(p.expr, ctx)); break;
        case 'inc': v = (MS.vars.toNumber(cur) || 0) + Number(p.amount); break;
        case 'dec': v = (MS.vars.toNumber(cur) || 0) - Number(p.amount); break;
        case 'toggle': v = !MS.vars.coerce('boolean', cur); break;
        case 'random': {
          const a = Math.ceil(Number(p.min)), b = Math.floor(Number(p.max));
          v = Math.floor(Math.random() * (b - a + 1)) + a;
          break;
        }
      }
      MS.vars.set(p.var, v, ctx);
    },
  });

  const TEXT_OPS = [['upper', 'GROSSBUCHSTABEN'], ['lower', 'kleinbuchstaben'], ['trim', 'Leerzeichen entfernen'], ['replace', 'Ersetzen'], ['substring', 'Teiltext'], ['length', 'Länge'], ['regex', 'RegEx-Treffer extrahieren']];
  A('text_manipulation', {
    name: 'Text bearbeiten', icon: 'text_fields', cat: 'vars',
    help: 'Wandelt einen Text um und speichert das Ergebnis in einer Variable.',
    params: [
      { key: 'source', label: 'Quelltext', type: 'text', magic: true, default: '', required: true },
      { key: 'op', label: 'Vorgang', type: 'select', options: TEXT_OPS, default: 'upper' },
      { key: 'find', label: 'Suchen nach', type: 'text', default: '', showIf: (p) => p.op === 'replace' },
      { key: 'with', label: 'Ersetzen durch', type: 'text', magic: true, default: '', showIf: (p) => p.op === 'replace' },
      { key: 'start', label: 'Startposition (ab 0)', type: 'number', min: 0, default: 0, showIf: (p) => p.op === 'substring' },
      { key: 'len', label: 'Länge', type: 'number', min: 0, default: 5, showIf: (p) => p.op === 'substring' },
      { key: 'pattern', label: 'Regulärer Ausdruck', type: 'text', default: '\\d+', showIf: (p) => p.op === 'regex' },
      { key: 'var', label: 'Ergebnis speichern in', type: 'var', required: true },
    ],
    describe: (p) => `${opt(TEXT_OPS, p.op)}: ${p.source} → ${varName(p.var)}`,
    run(ctx, p) {
      const s = M(p.source, ctx);
      let r;
      switch (p.op) {
        case 'upper': r = s.toUpperCase(); break;
        case 'lower': r = s.toLowerCase(); break;
        case 'trim': r = s.trim(); break;
        case 'replace': r = s.split(p.find).join(M(p.with, ctx)); break;
        case 'substring': r = s.substr(Number(p.start) || 0, Number(p.len) || 0); break;
        case 'length': r = s.length; break;
        case 'regex': { const m = new RegExp(p.pattern).exec(s); r = m ? (m[1] !== undefined ? m[1] : m[0]) : ''; break; }
      }
      MS.vars.set(p.var, r, ctx);
    },
  });

  // --- Bedingungen & Schleifen (Ablaufsteuerung, wird von der Engine ausgewertet)
  A('if', { name: 'Wenn (If)', icon: 'call_split', cat: 'flow', flow: true, help: 'Führt die folgenden Aktionen nur aus, wenn die Bedingungen erfüllt sind. „Ende Wenn“ wird automatisch ergänzt.', params: [condField, logicField], describe: condText });
  A('else_if', { name: 'Sonst wenn (Else If)', icon: 'alt_route', cat: 'flow', flow: true, help: 'Weiterer Zweig innerhalb eines Wenn-Blocks.', params: [condField, logicField], describe: condText });
  A('else', { name: 'Sonst (Else)', icon: 'subdirectory_arrow_right', cat: 'flow', flow: true, help: 'Wird ausgeführt, wenn keine vorherige Bedingung erfüllt war.', describe: () => '' });
  A('end_if', { name: 'Ende Wenn (End If)', icon: 'last_page', cat: 'flow', flow: true, help: 'Schließt einen Wenn-Block.', describe: () => '' });
  A('loop', {
    name: 'Schleife wiederholen', icon: 'repeat', cat: 'flow', flow: true,
    help: 'Wiederholt die Aktionen bis „Ende Schleife“. Der aktuelle Durchlauf steht in {iteration}.',
    params: [
      { key: 'mode', label: 'Wiederholen', type: 'select', options: [['count', 'Feste Anzahl'], ['while', 'Solange Bedingungen erfüllt'], ['forever', 'Endlos (bis Abbruch)']], default: 'count' },
      { key: 'count', label: 'Anzahl', type: 'number', min: 1, default: 3, showIf: (p) => p.mode === 'count' },
      Object.assign({}, condField, { showIf: (p) => p.mode === 'while' }),
      Object.assign({}, logicField, { showIf: (p) => p.mode === 'while' }),
    ],
    describe: (p) => (p.mode === 'count' ? `${p.count}× wiederholen` : p.mode === 'while' ? 'Solange: ' + condText(p) : 'Endlos'),
  });
  A('end_loop', { name: 'Ende Schleife', icon: 'keyboard_return', cat: 'flow', flow: true, help: 'Schließt eine Schleife.', describe: () => '' });
  A('break_loop', { name: 'Schleife verlassen', icon: 'logout', cat: 'flow', flow: true, help: 'Beendet die aktuelle Schleife sofort (Break).', describe: () => '' });
  A('continue_loop', { name: 'Nächster Durchlauf', icon: 'skip_next', cat: 'flow', flow: true, help: 'Springt zum nächsten Schleifendurchlauf (Continue).', describe: () => '' });

  A('wait', {
    name: 'Warten', icon: 'hourglass_empty', cat: 'flow',
    help: 'Wartet eine bestimmte Zeit, bevor die nächste Aktion ausgeführt wird.',
    params: [
      { key: 'value', label: 'Dauer', type: 'number', min: 0, default: 5 },
      { key: 'unit', label: 'Einheit', type: 'select', options: UNIT_OPTIONS, default: 's' },
    ],
    describe: (p) => `${p.value} ${unitLabel(p.unit)}`,
    async run(ctx, p) {
      const end = Date.now() + Number(p.value) * (UNIT_MS[p.unit] || 1000);
      while (Date.now() < end && !ctx.token.cancelled) await sleep(Math.min(250, end - Date.now()));
    },
  });

  A('wait_until', {
    name: 'Warten bis Bedingung', icon: 'pending', cat: 'flow',
    help: 'Wartet, bis die Bedingungen erfüllt sind (wird jede Sekunde geprüft), optional mit Zeitlimit.',
    params: [condField, logicField, { key: 'timeout', label: 'Zeitlimit in Sekunden (0 = keins)', type: 'number', min: 0, default: 0 }],
    describe: (p) => condText(p) + (Number(p.timeout) ? ` (max. ${p.timeout} s)` : ''),
    async run(ctx, p) {
      const end = Number(p.timeout) ? Date.now() + Number(p.timeout) * 1000 : Infinity;
      while (!ctx.token.cancelled && Date.now() < end) {
        if (MS.engine.checkAll(p.conditions, p.logic, ctx)) return;
        await sleep(1000);
      }
    },
  });

  // --- Makro Studio
  A('run_macro', {
    name: 'Makro ausführen', icon: 'play_circle', cat: 'macro',
    help: 'Startet die Aktionen eines anderen Makros.',
    params: [
      { key: 'macro', label: 'Makro', type: 'macro', required: true },
      { key: 'ignoreConstraints', label: 'Bedingungen ignorieren', type: 'bool', default: false },
      { key: 'wait', label: 'Warten, bis es fertig ist', type: 'bool', default: true },
    ],
    describe: (p) => macroName(p.macro),
    async run(ctx, p) {
      const m = MS.store.macro(p.macro);
      if (!m) throw new Error('Makro nicht gefunden');
      if (ctx.depth > 8) throw new Error('Zu tiefe Verschachtelung von Makroaufrufen');
      const pr = MS.engine.runMacro(m, { trigger: 'Makro ' + ctx.macroName, ignoreConstraints: p.ignoreConstraints, depth: ctx.depth + 1 });
      if (p.wait) await pr;
    },
  });

  A('set_macro_enabled', {
    name: 'Makro aktivieren/deaktivieren', icon: 'toggle_on', cat: 'macro',
    help: 'Schaltet ein Makro (oder dieses) ein oder aus.',
    params: [
      { key: 'macro', label: 'Makro', type: 'macro', allowThis: true, required: true, default: '__this' },
      { key: 'state', label: 'Aktion', type: 'select', options: [['on', 'Aktivieren'], ['off', 'Deaktivieren'], ['toggle', 'Umschalten']], default: 'off' },
    ],
    describe: (p) => `${macroName(p.macro)} ${({ on: 'aktivieren', off: 'deaktivieren', toggle: 'umschalten' })[p.state]}`,
    run(ctx, p) {
      const m = MS.store.macro(p.macro === '__this' ? ctx.macroId : p.macro);
      if (!m) throw new Error('Makro nicht gefunden');
      m.enabled = p.state === 'toggle' ? !m.enabled : p.state === 'on';
      MS.store.changed('macros');
    },
  });

  A('cancel_actions', {
    name: 'Makroaktionen abbrechen', icon: 'cancel', cat: 'macro',
    help: 'Bricht laufende Makros ab – dieses, ein bestimmtes oder alle.',
    params: [
      { key: 'target', label: 'Abbrechen', type: 'select', options: [['this', 'Dieses Makro'], ['macro', 'Bestimmtes Makro'], ['all', 'Alle laufenden Makros']], default: 'this' },
      { key: 'macro', label: 'Makro', type: 'macro', showIf: (p) => p.target === 'macro' },
    ],
    describe: (p) => (p.target === 'this' ? 'Dieses Makro' : p.target === 'all' ? 'Alle Makros' : macroName(p.macro)),
    run(ctx, p) {
      if (p.target === 'this') ctx.stop('Abgebrochen');
      else if (p.target === 'all') MS.engine.cancel(null);
      else MS.engine.cancel(p.macro);
    },
  });

  A('action_block', {
    name: 'Action Block', icon: 'widgets', cat: 'macro',
    help: 'Führt einen wiederverwendbaren Action Block aus. Eingaben werden übergeben, Ausgaben zurück in Variablen geschrieben.',
    params: [
      { key: 'block', label: 'Action Block', type: 'block', required: true },
      { key: 'io', label: 'Ein- und Ausgaben', type: 'blockio', default: { inputs: {}, outputs: {} } },
    ],
    describe: (p) => {
      const b = MS.store.block(p.block);
      return b ? `„${b.name}“` : '(fehlt)';
    },
    async run(ctx, p) {
      const b = MS.store.block(p.block);
      if (!b) throw new Error('Action Block nicht gefunden');
      if (ctx.depth > 8) throw new Error('Zu tiefe Verschachtelung');
      await MS.engine.runBlock(b, p.io || {}, ctx);
    },
  });

  A('log', {
    name: 'Ins Protokoll schreiben', icon: 'edit_document', cat: 'macro',
    help: 'Schreibt einen eigenen Eintrag ins Systemprotokoll.',
    params: [
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: '', required: true },
      { key: 'level', label: 'Stufe', type: 'select', options: [['user', 'Info'], ['warn', 'Warnung'], ['error', 'Fehler']], default: 'user' },
    ],
    describe: (p) => p.text,
    run: (ctx, p) => MS.log(p.level, M(p.text, ctx), ctx.macroName),
  });

  A('comment', {
    name: 'Kommentar', icon: 'sticky_note_2', cat: 'macro',
    help: 'Notiz im Makro – hat keine Wirkung.',
    params: [{ key: 'text', label: 'Kommentar', type: 'textarea', default: '' }],
    describe: (p) => p.text,
    run: () => {},
  });

  A('set_engine', {
    name: 'Makro Studio an/aus', icon: 'power_settings_new', cat: 'macro',
    help: 'Schaltet alle Makros global ein oder aus.',
    params: [{ key: 'state', label: 'Aktion', type: 'select', options: [['on', 'Einschalten'], ['off', 'Ausschalten']], default: 'off' }],
    describe: (p) => (p.state === 'on' ? 'Einschalten' : 'Ausschalten'),
    run(ctx, p) {
      MS.store.state.settings.enabled = p.state === 'on';
      MS.store.changed('settings');
    },
  });

  // ============================================================ BEDINGUNGEN
  const CONSTRAINT_CATS = [
    { id: 'datetime', name: 'Datum & Uhrzeit', icon: 'schedule' },
    { id: 'power', name: 'Akku & Strom', icon: 'battery_charging_full' },
    { id: 'device', name: 'Gerätestatus', icon: 'smartphone' },
    { id: 'location', name: 'Standort', icon: 'location_on' },
    { id: 'app', name: 'Variablen & Makros', icon: 'data_object' },
  ];

  C('time_range', {
    name: 'Zeitraum', icon: 'schedule', cat: 'datetime',
    help: 'Erfüllt, wenn die aktuelle Uhrzeit im Zeitraum liegt. Zeiträume über Mitternacht (z. B. 22:00–06:00) sind möglich.',
    params: [
      { key: 'from', label: 'Von', type: 'time', default: '08:00' },
      { key: 'to', label: 'Bis', type: 'time', default: '18:00' },
    ],
    describe: (p) => `${p.from}–${p.to}`,
    check(ctx, p) {
      const now = fmtTime(new Date());
      return p.from <= p.to ? now >= p.from && now < p.to : now >= p.from || now < p.to;
    },
  });
  C('weekday', {
    name: 'Wochentag', icon: 'date_range', cat: 'datetime',
    params: [{ key: 'days', label: 'Wochentage', type: 'chips', options: DAY_OPTIONS, default: [1, 2, 3, 4, 5] }],
    describe: (p) => daysText(p.days),
    check: (ctx, p) => (p.days || []).includes(new Date().getDay()),
  });
  C('day_of_month', {
    name: 'Tag im Monat', icon: 'calendar_month', cat: 'datetime',
    params: [{ key: 'days', label: 'Tage', type: 'chips', options: MONTHDAY_OPTIONS, default: [1] }],
    describe: (p) => 'Tag ' + listText(p.days, MONTHDAY_OPTIONS),
    check: (ctx, p) => (p.days || []).includes(new Date().getDate()),
  });
  C('month', {
    name: 'Monat', icon: 'event', cat: 'datetime',
    params: [{ key: 'months', label: 'Monate', type: 'chips', options: MONTH_OPTIONS, default: [new Date().getMonth()] }],
    describe: (p) => listText(p.months, MONTH_OPTIONS),
    check: (ctx, p) => (p.months || []).includes(new Date().getMonth()),
  });

  C('battery_level', {
    name: 'Akkustand', icon: 'battery_3_bar', cat: 'power', supported: hasBattery,
    params: [
      { key: 'op', label: 'Akkustand ist', type: 'select', options: [['lt', 'kleiner als'], ['gt', 'größer als']], default: 'lt' },
      { key: 'level', label: 'Prozent', type: 'number', min: 0, max: 100, default: 30 },
    ],
    describe: (p) => `Akku ${p.op === 'lt' ? '<' : '>'} ${p.level} %`,
    check(ctx, p) {
      const b = MS.device.battery;
      if (!b) return false;
      return p.op === 'lt' ? b.level < Number(p.level) : b.level > Number(p.level);
    },
  });
  C('charging', {
    name: 'Ladestatus', icon: 'battery_charging_full', cat: 'power', supported: hasBattery,
    params: [{ key: 'state', label: 'Gerät', type: 'select', options: [['charging', 'Wird geladen'], ['not', 'Wird nicht geladen']], default: 'charging' }],
    describe: (p) => (p.state === 'charging' ? 'Wird geladen' : 'Wird nicht geladen'),
    check(ctx, p) {
      const b = MS.device.battery;
      return !!b && b.charging === (p.state === 'charging');
    },
  });

  C('connectivity', {
    name: 'Netzwerkverbindung', icon: 'wifi', cat: 'device',
    params: [{ key: 'state', label: 'Zustand', type: 'select', options: [['online', 'Online'], ['offline', 'Offline']], default: 'online' }],
    describe: (p) => (p.state === 'online' ? 'Online' : 'Offline'),
    check: (ctx, p) => navigator.onLine === (p.state === 'online'),
  });
  C('orientation', {
    name: 'Bildschirmausrichtung', icon: 'screen_rotation', cat: 'device',
    params: [{ key: 'state', label: 'Ausrichtung', type: 'select', options: [['portrait', 'Hochformat'], ['landscape', 'Querformat']], default: 'portrait' }],
    describe: (p) => (p.state === 'portrait' ? 'Hochformat' : 'Querformat'),
    check: (ctx, p) => MS.device.orientation === p.state,
  });
  C('visibility', {
    name: 'App im Vordergrund', icon: 'visibility', cat: 'device',
    params: [{ key: 'state', label: 'App ist', type: 'select', options: [['visible', 'Sichtbar'], ['hidden', 'Im Hintergrund']], default: 'visible' }],
    describe: (p) => (p.state === 'visible' ? 'App sichtbar' : 'App im Hintergrund'),
    check: (ctx, p) => (document.visibilityState === 'visible') === (p.state === 'visible'),
  });
  C('dark_mode', {
    name: 'Dunkles Design', icon: 'dark_mode', cat: 'device',
    params: [{ key: 'state', label: 'System-Design', type: 'select', options: [['dark', 'Dunkel'], ['light', 'Hell']], default: 'dark' }],
    describe: (p) => (p.state === 'dark' ? 'Dunkles Design aktiv' : 'Helles Design aktiv'),
    check: (ctx, p) => !!window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches === (p.state === 'dark'),
  });

  C('geofence', {
    name: 'Ort', icon: 'share_location', cat: 'location', supported: hasGeo,
    help: 'Verwendet die zuletzt bekannte Position. Ohne bekannte Position ist die Bedingung nicht erfüllt.',
    params: [
      { key: 'state', label: 'Gerät ist', type: 'select', options: [['inside', 'Innerhalb'], ['outside', 'Außerhalb']], default: 'inside' },
      { key: 'place', label: 'Ort', type: 'location', default: { name: '', lat: '', lon: '', radius: 150 } },
    ],
    describe: (p) => `${p.state === 'inside' ? 'In' : 'Außerhalb von'} ${placeText(p.place)}`,
    check(ctx, p) {
      const pos = MS.device.position, pl = p.place || {};
      if (!pos) { MS.device.getPosition().catch(() => {}); return false; }
      const inside = MS.geo.distance(pos.lat, pos.lon, parseFloat(pl.lat), parseFloat(pl.lon)) <= (Number(pl.radius) || 150);
      return inside === (p.state === 'inside');
    },
  });

  C('variable', {
    name: 'Variablenwert', icon: 'data_object', cat: 'app',
    help: 'Vergleicht eine Variable mit einem Wert (Zahlen werden numerisch verglichen).',
    params: [
      { key: 'var', label: 'Variable', type: 'var', required: true },
      { key: 'op', label: 'Vergleich', type: 'select', options: MS.COMPARE_OPS, default: 'eq' },
      { key: 'value', label: 'Wert', type: 'text', magic: true, default: '' },
    ],
    describe: (p) => `${varName(p.var)} ${opt(MS.COMPARE_OPS, p.op)} ${p.value}`,
    check: (ctx, p) => MS.compare(MS.vars.get(p.var, ctx), p.op, M(p.value, ctx)),
  });
  C('macro_state', {
    name: 'Makro aktiviert', icon: 'toggle_on', cat: 'app',
    params: [
      { key: 'macro', label: 'Makro', type: 'macro', required: true },
      { key: 'state', label: 'Zustand', type: 'select', options: [['on', 'Aktiviert'], ['off', 'Deaktiviert']], default: 'on' },
    ],
    describe: (p) => `${macroName(p.macro)} ${p.state === 'on' ? 'aktiviert' : 'deaktiviert'}`,
    check(ctx, p) {
      const m = MS.store.macro(p.macro);
      return !!m && m.enabled === (p.state === 'on');
    },
  });
  C('macro_running', {
    name: 'Makro läuft', icon: 'directions_run', cat: 'app',
    params: [
      { key: 'macro', label: 'Makro', type: 'macro', required: true },
      { key: 'state', label: 'Zustand', type: 'select', options: [['yes', 'Läuft gerade'], ['no', 'Läuft nicht']], default: 'no' },
    ],
    describe: (p) => `${macroName(p.macro)} ${p.state === 'yes' ? 'läuft' : 'läuft nicht'}`,
    check: (ctx, p) => MS.engine.isRunning(p.macro, ctx && ctx.runId) === (p.state === 'yes'),
  });

  // ------------------------------------------------------------- Export
  const maps = { trigger: triggers, action: actions, constraint: constraints };
  MS.catalog = {
    triggers, actions, constraints, FLOW,
    categories: { trigger: TRIGGER_CATS, action: ACTION_CATS, constraint: CONSTRAINT_CATS },
    map: (kind) => maps[kind],
    get: (kind, type) => maps[kind][type],
    /** Neue Instanz eines Katalogeintrags mit Standardparametern. */
    create(kind, type) {
      const d = maps[kind][type];
      const params = {};
      for (const f of d.params) if (f.key) params[f.key] = MS.util.clone(f.default !== undefined ? f.default : f.type === 'bool' ? false : '');
      const item = { id: uid(), type, params, enabled: true };
      if (kind === 'constraint') item.invert = false;
      return item;
    },
    describe(kind, item) {
      const d = maps[kind][item.type];
      if (!d) return 'Unbekannter Typ: ' + item.type;
      try { return d.describe ? d.describe(item.params || {}) : ''; } catch (e) { return ''; }
    },
    supported(d) {
      try { return !d.supported || d.supported(); } catch (e) { return false; }
    },
    notify,
    setWake,
  };
})();
