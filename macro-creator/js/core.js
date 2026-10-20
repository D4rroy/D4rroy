/* Makro Studio – Kern: Hilfsfunktionen, Ereignisbus, Speicher, Variablen,
 * Magic Text, Rechner, Gerätezustand (Akku, Netz, Sensoren, Standort). */
'use strict';
(function () {
  const MS = (window.MS = window.MS || {});

  // ---------------------------------------------------------------- Hilfen
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const fmtTime = (d, sec) => pad(d.getHours()) + ':' + pad(d.getMinutes()) + (sec ? ':' + pad(d.getSeconds()) : '');
  const fmtDate = (d) => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  const fmtDateTime = (d) => fmtDate(d) + ' ' + fmtTime(d, true);

  /** Datum für "HH:MM" am selben Tag wie `base`. */
  function atTime(base, hhmm) {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    const d = new Date(base);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  }
  /** true, wenn `target` zwischen zwei Ticks liegt (verpasste Ticks bis 1 h werden nachgeholt). */
  const crossed = (prev, target, now) => prev < target && target <= now && now - target < 3600e3;

  MS.util = { uid, clone, pad, sleep, WEEKDAYS, WEEKDAYS_LONG, MONTHS, fmtTime, fmtDate, fmtDateTime, atTime, crossed };

  // ------------------------------------------------------------ Ereignisbus
  const handlers = {};
  MS.bus = {
    on(evt, fn) {
      (handlers[evt] = handlers[evt] || new Set()).add(fn);
      return () => MS.bus.off(evt, fn);
    },
    off(evt, fn) {
      if (handlers[evt]) handlers[evt].delete(fn);
    },
    emit(evt, data) {
      if (!handlers[evt]) return;
      for (const fn of [...handlers[evt]]) {
        try { fn(data); } catch (e) { console.error(e); }
      }
    },
  };

  // --------------------------------------------------------------- Speicher
  const KEY = 'makrostudio.v1';
  const defaults = () => ({
    version: 1,
    settings: {
      enabled: true,
      theme: 'system',
      lat: '',
      lon: '',
      logLimit: 500,
      logActions: true,
      keepAwake: false,
    },
    macros: [],
    variables: [],
    blocks: [],
    categories: ['Allgemein'],
    log: [],
  });
  let saveTimer = null;

  MS.store = {
    state: defaults(),
    persistent: true,
    defaults,
    load() {
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { this.persistent = false; }
      if (raw) {
        try {
          const data = JSON.parse(raw);
          this.state = Object.assign(defaults(), data);
          this.state.settings = Object.assign(defaults().settings, data.settings || {});
        } catch (e) { console.warn('Gespeicherte Daten unlesbar', e); }
      }
      return this.state;
    },
    save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.saveNow(), 200);
    },
    saveNow() {
      clearTimeout(saveTimer);
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { this.persistent = false; }
    },
    /** Speichert und benachrichtigt Ansichten/Engine. what: 'macros' | 'vars' | 'blocks' | 'settings' | 'all' */
    changed(what) {
      this.save();
      MS.bus.emit('store', what);
    },
    macro(id) { return this.state.macros.find((m) => m.id === id); },
    block(id) { return this.state.blocks.find((b) => b.id === id); },
    ensureCategory(name) {
      if (name && !this.state.categories.includes(name)) this.state.categories.push(name);
    },
  };
  window.addEventListener('pagehide', () => MS.store.saveNow());

  // -------------------------------------------------------------- Protokoll
  MS.LOG_LEVELS = { info: 'Makro', action: 'Aktion', user: 'Benutzer', warn: 'Warnung', error: 'Fehler' };
  MS.log = function (level, msg, source) {
    const s = MS.store.state;
    const limit = Number(s.settings.logLimit) || 500;
    s.log.unshift({ t: Date.now(), level, msg: String(msg), source: source || '' });
    if (s.log.length > limit) s.log.length = limit;
    MS.store.save();
    MS.bus.emit('log');
  };

  // -------------------------------------------------------------- Variablen
  const VAR_TYPES = { boolean: 'Boolesch', integer: 'Ganzzahl', decimal: 'Dezimalzahl', string: 'Zeichenkette' };
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s = String(v ?? '').trim().replace(',', '.');
    return s === '' ? NaN : Number(s);
  }
  function coerce(type, v) {
    switch (type) {
      case 'boolean':
        if (typeof v === 'string') return ['true', '1', 'ja', 'wahr', 'an', 'on', 'yes'].includes(v.trim().toLowerCase());
        return !!v;
      case 'integer': {
        const n = toNumber(v);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
      }
      case 'decimal': {
        const n = toNumber(v);
        return Number.isFinite(n) ? n : 0;
      }
      default:
        return v === undefined || v === null ? '' : String(v);
    }
  }

  MS.vars = {
    TYPES: VAR_TYPES,
    coerce,
    toNumber,
    /** Referenzen: "g:name" (global) oder "l:name" (lokal im Makro). */
    parseRef(ref) {
      if (!ref) return null;
      const i = ref.indexOf(':');
      return i < 0 ? { scope: 'g', name: ref } : { scope: ref.slice(0, i), name: ref.slice(i + 1) };
    },
    resolve(ref, ctx) {
      const r = this.parseRef(ref);
      if (!r) return null;
      const list = r.scope === 'l' ? (ctx && ctx.locals) || [] : MS.store.state.variables;
      return list.find((v) => v.name === r.name) || null;
    },
    get(ref, ctx) {
      const v = this.resolve(ref, ctx);
      return v ? v.value : undefined;
    },
    set(ref, value, ctx) {
      const v = this.resolve(ref, ctx);
      if (!v) {
        MS.log('warn', `Variable „${this.label(ref)}“ nicht gefunden`, ctx && ctx.macroName);
        return false;
      }
      const old = v.value;
      v.value = coerce(v.type, value);
      MS.store.save();
      const r = this.parseRef(ref);
      if (old !== v.value) MS.bus.emit('var-changed', { scope: r.scope, name: v.name, old, value: v.value });
      MS.bus.emit('vars');
      return true;
    },
    label(ref) {
      const r = this.parseRef(ref);
      if (!r) return '–';
      return (r.scope === 'l' ? 'lokal ' : '') + r.name;
    },
    format(v) {
      if (v === undefined) return '';
      return String(v);
    },
    validName(name) {
      return /^[^{}=:\s][^{}=:]*$/.test(name || '') && name.trim() === name;
    },
  };

  // ------------------------------------------------------------- Rechner
  /** Sicherer Ausdrucksrechner: + - * / % ^, Klammern, min/max/round/… */
  MS.calc = function (expr) {
    const s = String(expr);
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const fail = (msg) => { throw new Error(msg || `Ungültiger Ausdruck bei Position ${i + 1}`); };
    const FN = {
      abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, min: Math.min, max: Math.max, pow: Math.pow,
      sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log,
      round: (x, d = 0) => { const f = Math.pow(10, d); return Math.round(x * f) / f; },
      random: (a = 0, b = 1) => Math.floor(Math.random() * (b - a + 1)) + a,
    };
    const CONST = { pi: Math.PI, e: Math.E, true: 1, false: 0 };
    function expr0() {
      let v = term();
      for (;;) {
        ws();
        if (s[i] === '+') { i++; v += term(); }
        else if (s[i] === '-') { i++; v -= term(); }
        else return v;
      }
    }
    function term() {
      let v = unary();
      for (;;) {
        ws();
        if (s[i] === '*') { i++; v *= unary(); }
        else if (s[i] === '/') { i++; v /= unary(); }
        else if (s[i] === '%') { i++; v %= unary(); }
        else return v;
      }
    }
    function unary() {
      ws();
      if (s[i] === '-') { i++; return -unary(); }
      if (s[i] === '+') { i++; return unary(); }
      return power();
    }
    function power() {
      const b = primary();
      ws();
      if (s[i] === '^') { i++; return Math.pow(b, unary()); }
      return b;
    }
    function primary() {
      ws();
      if (s[i] === '(') {
        i++;
        const v = expr0();
        ws();
        if (s[i] !== ')') fail('„)“ fehlt');
        i++;
        return v;
      }
      const num = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec(s.slice(i));
      if (num) { i += num[0].length; return Number(num[0].replace(',', '.')); }
      const id = /^[a-z_]+/i.exec(s.slice(i));
      if (id) {
        const name = id[0].toLowerCase();
        i += id[0].length;
        ws();
        if (s[i] === '(') {
          i++;
          const args = [];
          ws();
          if (s[i] !== ')') {
            for (;;) {
              args.push(expr0());
              ws();
              if (s[i] === ';' || s[i] === ',') { i++; continue; }
              break;
            }
          }
          if (s[i] !== ')') fail('„)“ fehlt');
          i++;
          if (!FN[name]) fail(`Unbekannte Funktion „${name}“`);
          return FN[name](...args);
        }
        if (name in CONST) return CONST[name];
        fail(`Unbekannter Name „${name}“`);
      }
      fail();
    }
    const v = expr0();
    ws();
    if (i < s.length) fail();
    return v;
  };

  // ----------------------------------------------------------- Vergleiche
  MS.COMPARE_OPS = [
    ['eq', '='], ['ne', '≠'], ['lt', '<'], ['le', '≤'], ['gt', '>'], ['ge', '≥'],
    ['contains', 'enthält'], ['not_contains', 'enthält nicht'], ['starts', 'beginnt mit'], ['ends', 'endet mit'], ['regex', 'passt zu RegEx'],
  ];
  MS.compare = function (a, op, b) {
    const na = toNumber(a), nb = toNumber(b);
    const num = Number.isFinite(na) && Number.isFinite(nb);
    const sa = String(a ?? ''), sb = String(b ?? '');
    switch (op) {
      case 'eq': return num ? na === nb : sa.toLowerCase() === sb.toLowerCase();
      case 'ne': return !MS.compare(a, 'eq', b);
      case 'lt': return num ? na < nb : sa.localeCompare(sb) < 0;
      case 'le': return num ? na <= nb : sa.localeCompare(sb) <= 0;
      case 'gt': return num ? na > nb : sa.localeCompare(sb) > 0;
      case 'ge': return num ? na >= nb : sa.localeCompare(sb) >= 0;
      case 'contains': return sa.toLowerCase().includes(sb.toLowerCase());
      case 'not_contains': return !sa.toLowerCase().includes(sb.toLowerCase());
      case 'starts': return sa.toLowerCase().startsWith(sb.toLowerCase());
      case 'ends': return sa.toLowerCase().endsWith(sb.toLowerCase());
      case 'regex':
        try { return new RegExp(sb, 'i').test(sa); } catch (e) { return false; }
      default: return false;
    }
  };

  // ------------------------------------------------------------- Geo
  const rad = Math.PI / 180;
  MS.geo = {
    distance(lat1, lon1, lat2, lon2) {
      const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
      return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    /** Standort aus den Einstellungen, sonst letzte bekannte Position. */
    home() {
      const st = MS.store.state.settings;
      const lat = parseFloat(st.lat), lon = parseFloat(st.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
      return MS.device.position;
    },
    /** Sonnenauf- und -untergang (Algorithmus nach der "Sunrise equation"). */
    sunTimes(date, lat, lng) {
      const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397, J0 = 0.0009;
      const noon = new Date(date); noon.setHours(12, 0, 0, 0);
      const d = noon.valueOf() / dayMs - 0.5 + J1970 - J2000;
      const lw = rad * -lng, phi = rad * lat;
      const n = Math.round(d - J0 - lw / (2 * Math.PI));
      const ds = J0 + lw / (2 * Math.PI) + n;
      const M = rad * (357.5291 + 0.98560028 * ds);
      const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
      const L = M + C + rad * 102.9372 + Math.PI;
      const dec = Math.asin(Math.sin(e) * Math.sin(L));
      const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
      const Jset = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      const Jrise = Jnoon - (Jset - Jnoon);
      const fromJ = (j) => new Date((j + 0.5 - J1970) * dayMs);
      return { sunrise: fromJ(Jrise), sunset: fromJ(Jset) };
    },
  };

  // ------------------------------------------------------- Gerätezustand
  const portrait = () => (window.matchMedia && matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape');
  const dev = (MS.device = {
    battery: null, // { level: 0–100, charging: bool }
    online: navigator.onLine,
    visible: document.visibilityState === 'visible',
    orientation: portrait(),
    faceDown: null,
    position: null, // { lat, lon, acc, t }
    lastMotion: null,
    geoUsers: 0,
    geoId: null,

    async init() {
      // Uhr – ein Takt pro Sekunde, prev/now erlauben das Nachholen verpasster Zeitpunkte
      let prev = new Date();
      setInterval(() => {
        const now = new Date();
        MS.bus.emit('tick', { prev, now });
        prev = now;
      }, 1000);

      window.addEventListener('online', () => this.setOnline(true));
      window.addEventListener('offline', () => this.setOnline(false));
      document.addEventListener('visibilitychange', () => {
        this.visible = document.visibilityState === 'visible';
        MS.bus.emit('visibility', { visible: this.visible });
      });
      if (window.matchMedia) {
        matchMedia('(orientation: portrait)').addEventListener('change', () => {
          this.orientation = portrait();
          MS.bus.emit('orientation', { orientation: this.orientation });
        });
      }
      window.addEventListener('devicemotion', (e) => this.onMotion(e));

      if (navigator.getBattery) {
        try {
          const b = await navigator.getBattery();
          const read = () => ({ level: Math.round(b.level * 100), charging: b.charging });
          this.battery = read();
          const upd = () => {
            const prev = this.battery;
            this.battery = read();
            MS.bus.emit('battery', { ...this.battery, prevLevel: prev && prev.level, prevCharging: prev && prev.charging });
          };
          b.addEventListener('levelchange', upd);
          b.addEventListener('chargingchange', upd);
        } catch (e) { /* nicht verfügbar */ }
      }
    },
    setOnline(on) {
      if (this.online === on) return;
      this.online = on;
      MS.bus.emit('connectivity', { online: on });
    },
    onMotion(e) {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      const last = this.lastMotion;
      this.lastMotion = { x: g.x, y: g.y, z: g.z };
      if (last) {
        const force = Math.abs(g.x - last.x) + Math.abs(g.y - last.y) + Math.abs(g.z - last.z);
        if (force > 12) MS.bus.emit('shake', { force });
      }
      const down = g.z < -8 ? true : g.z > 8 ? false : this.faceDown;
      if (down !== this.faceDown) {
        const had = this.faceDown !== null;
        this.faceDown = down;
        if (had) MS.bus.emit('flip', { faceDown: down });
      }
    },
    async requestMotionPermission() {
      const DME = window.DeviceMotionEvent;
      if (DME && typeof DME.requestPermission === 'function') return (await DME.requestPermission()) === 'granted';
      return !!DME;
    },
    setPosition(p) {
      this.position = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      MS.bus.emit('position', this.position);
    },
    /** Startet die Standortüberwachung, solange mindestens ein Nutzer sie braucht. */
    requireLocation() {
      if (!navigator.geolocation) return () => {};
      this.geoUsers++;
      if (this.geoId === null) {
        this.geoId = navigator.geolocation.watchPosition(
          (p) => this.setPosition(p),
          (err) => MS.log('warn', 'Standort: ' + err.message, 'System'),
          { enableHighAccuracy: true, maximumAge: 30000 }
        );
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--this.geoUsers <= 0 && this.geoId !== null) {
          navigator.geolocation.clearWatch(this.geoId);
          this.geoId = null;
          this.geoUsers = 0;
        }
      };
    },
    getPosition(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Standort wird nicht unterstützt'));
        navigator.geolocation.getCurrentPosition(
          (p) => { this.setPosition(p); resolve(this.position); },
          (err) => reject(new Error(err.message || 'Standort nicht verfügbar')),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 }
        );
      });
    },
  });

  // ------------------------------------------------------------ Magic Text
  MS.magic = {
    TOKENS: [
      ['{time}', 'Uhrzeit (HH:MM)'], ['{time_s}', 'Uhrzeit mit Sekunden'], ['{date}', 'Datum'], ['{weekday}', 'Wochentag'],
      ['{day}', 'Tag'], ['{month}', 'Monat (Zahl)'], ['{month_name}', 'Monatsname'], ['{year}', 'Jahr'],
      ['{hour}', 'Stunde'], ['{minute}', 'Minute'], ['{timestamp}', 'Unix-Zeitstempel'],
      ['{battery}', 'Akkustand in %'], ['{charging}', 'Lädt (ja/nein)'], ['{online}', 'Online (ja/nein)'],
      ['{lat}', 'Breitengrad'], ['{lon}', 'Längengrad'],
      ['{macro_name}', 'Makroname'], ['{trigger}', 'Auslöser'], ['{trigger_info}', 'Auslöser-Details'],
      ['{iteration}', 'Schleifendurchlauf'], ['{random=1-100}', 'Zufallszahl (min-max)'], ['{device}', 'Plattform'],
      ['{newline}', 'Zeilenumbruch'],
    ],
    apply(text, ctx) {
      if (text === undefined || text === null) return '';
      return String(text).replace(/\{([a-z_]+)(?:=([^{}]*))?\}/gi, (m, key, arg) => {
        const r = resolveToken(key.toLowerCase(), arg, ctx);
        return r === undefined ? m : String(r);
      });
    },
  };
  function resolveToken(key, arg, ctx) {
    const d = new Date();
    const yn = (b) => (b ? 'ja' : 'nein');
    switch (key) {
      case 'time': return fmtTime(d);
      case 'time_s': return fmtTime(d, true);
      case 'date': return fmtDate(d);
      case 'weekday': return WEEKDAYS_LONG[d.getDay()];
      case 'day': return d.getDate();
      case 'month': return d.getMonth() + 1;
      case 'month_name': return MONTHS[d.getMonth()];
      case 'year': return d.getFullYear();
      case 'hour': return pad(d.getHours());
      case 'minute': return pad(d.getMinutes());
      case 'second': return pad(d.getSeconds());
      case 'timestamp': return Math.floor(d / 1000);
      case 'battery': return dev.battery ? dev.battery.level : '?';
      case 'charging': return dev.battery ? yn(dev.battery.charging) : '?';
      case 'online': return yn(navigator.onLine);
      case 'lat': return dev.position ? dev.position.lat.toFixed(6) : '?';
      case 'lon': return dev.position ? dev.position.lon.toFixed(6) : '?';
      case 'macro_name': return ctx ? ctx.macroName : '';
      case 'trigger': return ctx ? ctx.trigger || '' : '';
      case 'trigger_info': return ctx ? ctx.triggerInfo || '' : '';
      case 'iteration': return ctx ? ctx.iteration || 0 : 0;
      case 'device': return (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
      case 'newline': return '\n';
      case 'random': {
        const [a, b] = String(arg || '0-100').split('-').map(Number);
        const lo = Number.isFinite(a) ? a : 0, hi = Number.isFinite(b) ? b : 100;
        return Math.floor(Math.random() * (hi - lo + 1)) + lo;
      }
      case 'v': {
        const v = MS.vars.resolve('g:' + arg, ctx);
        return v ? MS.vars.format(v.value) : undefined;
      }
      case 'lv': {
        const v = MS.vars.resolve('l:' + arg, ctx);
        return v ? MS.vars.format(v.value) : undefined;
      }
      default: return undefined;
    }
  }
})();
