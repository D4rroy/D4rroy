/* Makro Studio – Geräte-Auslöser, -Aktionen und -Bedingungen der Android-App:
 * Telefon & SMS, WLAN/Netz, Bildschirm, Kopfhörer, Lautstärketasten, Kalender, NFC,
 * Schnelleinstellungs-Kacheln, Webhook, Dateien, E-Mail, Texterkennung u. v. m.
 * Die Ereignisse kommen vom Android-Systemmonitor über MS.bus ('sys:<name>'). */
'use strict';
(function () {
  const MS = window.MS;
  const { T, A, C } = MS.catalog.def;
  const { M, opt, varName, appName, nativeOnly, due, UNIT_OPTIONS, UNIT_MS, unitLabel } = MS.catalog.helpers;
  const sys = (name, fn) => MS.bus.on('sys:' + name, fn);
  const lc = (s) => String(s ?? '').toLowerCase();
  const has = (text, part) => !part || lc(text).includes(lc(part));
  const store = (ref, value, ctx) => { if (ref) MS.vars.set(ref, value, ctx); };
  const yn = (b) => (b ? 'an' : 'aus');

  /** Gerätezustand (für Bedingungen) – kurz zwischengespeichert, weil oft mehrere Bedingungen ihn lesen. */
  let stateCache = null, stateAt = 0;
  function state() {
    if (!MS.native.available) return {};
    if (!stateCache || Date.now() - stateAt > 500) { stateCache = MS.native.deviceState(); stateAt = Date.now(); }
    return stateCache;
  }

  MS.catalog.categories.trigger.splice(3, 0, { id: 'phone', name: 'Telefon & SMS', icon: 'call' });
  MS.catalog.categories.action.splice(4, 0, { id: 'phone', name: 'Telefon & SMS', icon: 'call' }, { id: 'files', name: 'Dateien & System', icon: 'folder' });

  // ================================================================ AUSLÖSER
  const CALL_EVENTS = [['incoming', 'Eingehender Anruf (klingelt)'], ['answered', 'Anruf angenommen'], ['outgoing', 'Ausgehender Anruf'], ['missed', 'Verpasster Anruf'], ['ended', 'Anruf beendet']];
  T('call', {
    name: 'Anruf', icon: 'ring_volume', cat: 'phone', supported: nativeOnly, needs: ['phone'],
    help: 'Löst bei Anrufen aus – klingelt, angenommen, ausgehend, verpasst oder beendet. Magic Text: {call_number}.',
    params: [
      { key: 'event', label: 'Ereignis', type: 'select', options: CALL_EVENTS, default: 'incoming' },
      { key: 'number', label: 'Nummer enthält (leer = jede)', type: 'text', default: '' },
    ],
    describe: (p) => `${opt(CALL_EVENTS, p.event)}${p.number ? ' · ' + p.number : ''}`,
    start(p, fire) {
      return sys('call', ({ event, number }) => {
        if (event !== p.event) return;
        const digits = (s) => String(s || '').replace(/[^\d+]/g, '');
        if (p.number && !digits(number).includes(digits(p.number).replace(/^\+?49|^0/, ''))) return;
        fire({ info: number || 'unbekannt', data: { call_number: number || '' } });
      });
    },
  });

  T('sms_received', {
    name: 'SMS empfangen', icon: 'sms', cat: 'phone', supported: nativeOnly, needs: ['sms'],
    help: 'Löst aus, wenn eine SMS eintrifft. Magic Text: {sms_from}, {sms_text}.',
    params: [
      { key: 'from', label: 'Absender enthält (leer = jeder)', type: 'text', default: '' },
      { key: 'contains', label: 'Text enthält (optional)', type: 'text', default: '' },
    ],
    describe: (p) => `${p.from || 'Jeder Absender'}${p.contains ? ` · enthält „${p.contains}“` : ''}`,
    start(p, fire) {
      return sys('sms', ({ from, text }) => {
        if (!has(from, p.from) || !has(text, p.contains)) return;
        fire({ info: from, data: { sms_from: from, sms_text: text } });
      });
    },
  });

  T('wifi_network', {
    name: 'WLAN-Netz verbunden/getrennt', icon: 'wifi_find', cat: 'connectivity', supported: nativeOnly, needs: ['location'],
    help: 'Löst aus, wenn sich das Handy mit einem bestimmten WLAN verbindet oder es verlässt. Android verrät den WLAN-Namen nur mit Standortberechtigung und eingeschaltetem Standort. Magic Text: {ssid}.',
    params: [
      { key: 'event', label: 'Ereignis', type: 'select', options: [['connected', 'Verbunden'], ['disconnected', 'Getrennt']], default: 'connected' },
      { key: 'ssid', label: 'WLAN-Name (leer = jedes WLAN, mehrere mit Komma)', type: 'text', default: '' },
    ],
    describe: (p) => `${p.ssid || 'Jedes WLAN'} ${p.event === 'connected' ? 'verbunden' : 'getrennt'}`,
    start(p, fire) {
      const names = String(p.ssid || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const hit = (ssid) => !names.length || names.includes(lc(ssid));
      let last = (state().network || {}).ssid || '';
      return sys('network', ({ type, ssid }) => {
        const now = type === 'wifi' ? ssid || '' : '';
        if (now === last) return;
        const prev = last;
        last = now;
        if (p.event === 'connected' && now && hit(now)) fire({ info: now, data: { ssid: now } });
        if (p.event === 'disconnected' && prev && hit(prev)) fire({ info: prev, data: { ssid: prev } });
      });
    },
  });

  const NET_TYPES = [['wifi', 'WLAN'], ['mobile', 'Mobilfunk'], ['ethernet', 'Ethernet'], ['vpn', 'VPN'], ['none', 'Keine Verbindung']];
  T('network_type', {
    name: 'Netzwerkart geändert', icon: 'signal_cellular_alt', cat: 'connectivity', supported: nativeOnly,
    help: 'Löst aus, wenn das Handy z. B. von WLAN zu Mobilfunk wechselt. Magic Text: {network_type}.',
    params: [{ key: 'type', label: 'Neue Verbindung', type: 'select', options: [['any', 'Jede Änderung'], ...NET_TYPES], default: 'mobile' }],
    describe: (p) => (p.type === 'any' ? 'Jede Änderung' : 'Wechsel zu ' + opt(NET_TYPES, p.type)),
    start(p, fire) {
      let last = (state().network || {}).type;
      return sys('network', ({ type }) => {
        if (type === last) return;
        last = type;
        if (p.type === 'any' || p.type === type) fire({ info: opt(NET_TYPES, type), data: { network_type: opt(NET_TYPES, type) } });
      });
    },
  });

  const RADIOS = [['wifi_state', 'WLAN'], ['bt_state', 'Bluetooth'], ['airplane', 'Flugmodus'], ['power_save', 'Energiesparmodus']];
  T('radio_state', {
    name: 'WLAN/Bluetooth/Flugmodus ein-/ausgeschaltet', icon: 'toggle_on', cat: 'connectivity', supported: nativeOnly,
    help: 'Löst aus, wenn WLAN, Bluetooth, Flugmodus oder Energiesparmodus ein- oder ausgeschaltet werden.',
    params: [
      { key: 'radio', label: 'Funktion', type: 'select', options: RADIOS, default: 'wifi_state' },
      { key: 'state', label: 'Ereignis', type: 'select', options: [['on', 'Eingeschaltet'], ['off', 'Ausgeschaltet'], ['any', 'Beides']], default: 'on' },
    ],
    describe: (p) => `${opt(RADIOS, p.radio)} ${({ on: 'eingeschaltet', off: 'ausgeschaltet', any: 'umgeschaltet' })[p.state]}`,
    start(p, fire) {
      return sys(p.radio, ({ on }) => {
        if (p.state === 'any' || (p.state === 'on') === on) fire({ info: `${opt(RADIOS, p.radio)} ${yn(on)}` });
      });
    },
  });

  const SCREEN = [['on', 'Bildschirm eingeschaltet'], ['off', 'Bildschirm ausgeschaltet'], ['unlocked', 'Gerät entsperrt']];
  T('screen', {
    name: 'Bildschirm an/aus/entsperrt', icon: 'phone_android', cat: 'device', supported: nativeOnly,
    help: 'Löst aus, wenn der Bildschirm ein- oder ausgeschaltet oder das Gerät entsperrt wird.',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: SCREEN, default: 'on' }],
    describe: (p) => opt(SCREEN, p.state),
    start(p, fire) {
      return sys('screen', ({ state: s }) => { if (s === p.state) fire({ info: opt(SCREEN, s) }); });
    },
  });

  const HP_TYPES = [['any', 'Alle'], ['wired', 'Kabel/USB'], ['bluetooth', 'Bluetooth']];
  T('headphones', {
    name: 'Kopfhörer ein-/ausgesteckt', icon: 'headphones', cat: 'device', supported: nativeOnly,
    help: 'Löst aus, wenn Kopfhörer (Kabel, USB oder Bluetooth) verbunden oder getrennt werden. Magic Text: {headphones_name}.',
    params: [
      { key: 'state', label: 'Ereignis', type: 'select', options: [['connected', 'Verbunden'], ['disconnected', 'Getrennt']], default: 'connected' },
      { key: 'kind', label: 'Art', type: 'select', options: HP_TYPES, default: 'any' },
    ],
    describe: (p) => `${p.kind === 'any' ? 'Kopfhörer' : opt(HP_TYPES, p.kind) + '-Kopfhörer'} ${p.state === 'connected' ? 'verbunden' : 'getrennt'}`,
    start(p, fire) {
      return sys('headphones', ({ connected, type, name }) => {
        if (connected !== (p.state === 'connected') || (p.kind !== 'any' && p.kind !== type)) return;
        fire({ info: name, data: { headphones_name: name } });
      });
    },
  });

  // Lautstärketasten: Android meldet sie über die Bedienungshilfe; „verschlucken“ verhindert die Lautstärkeänderung
  const volumeUsers = new Set();
  const syncVolume = () => {
    if (!MS.native.available) return;
    MS.native.setFlag('volume_watch', volumeUsers.size > 0);
    MS.native.setFlag('volume_consume', [...volumeUsers].some((u) => u.consume));
  };
  const KEYS = [['up', 'Lauter'], ['down', 'Leiser'], ['any', 'Beide']];
  T('volume_button', {
    name: 'Lautstärketaste gedrückt', icon: 'volume_up', cat: 'device', supported: nativeOnly, needs: ['accessibility'],
    help: 'Löst aus, wenn eine Lautstärketaste gedrückt wird (auch bei ausgeschaltetem Bildschirm, wenn das System es meldet). Benötigt die Bedienungshilfe. Optional ändert sich die Lautstärke dabei nicht.',
    params: [
      { key: 'key', label: 'Taste', type: 'select', options: KEYS, default: 'up' },
      { key: 'consume', label: 'Lautstärke dabei nicht ändern', type: 'bool', default: false },
    ],
    describe: (p) => `${opt(KEYS, p.key)}${p.consume ? ' (Lautstärke bleibt)' : ''}`,
    start(p, fire) {
      const u = { consume: !!p.consume };
      volumeUsers.add(u);
      syncVolume();
      const off = sys('volume_key', ({ key }) => { if (p.key === 'any' || p.key === key) fire({ info: opt(KEYS, key) }); });
      return () => { off(); volumeUsers.delete(u); syncVolume(); };
    },
  });

  T('music_playing', {
    name: 'Musik startet/stoppt', icon: 'music_note', cat: 'device', supported: nativeOnly,
    help: 'Löst aus, wenn eine App Musik oder andere Medien abspielt bzw. damit aufhört.',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: [['start', 'Wiedergabe startet'], ['stop', 'Wiedergabe stoppt']], default: 'start' }],
    describe: (p) => (p.state === 'start' ? 'Wiedergabe startet' : 'Wiedergabe stoppt'),
    start(p, fire) {
      return sys('music', ({ playing }) => { if (playing === (p.state === 'start')) fire({ info: playing ? 'startet' : 'stoppt' }); });
    },
  });

  T('app_install', {
    name: 'App installiert/entfernt', icon: 'install_mobile', cat: 'apps', supported: nativeOnly,
    help: 'Löst aus, wenn eine App installiert oder deinstalliert wird (Updates zählen nicht). Magic Text: {app_name}, {app_package}.',
    params: [
      { key: 'event', label: 'Ereignis', type: 'select', options: [['installed', 'Installiert'], ['removed', 'Entfernt']], default: 'installed' },
      { key: 'filter', label: 'Name oder Paket enthält (leer = jede App)', type: 'text', default: '' },
    ],
    describe: (p) => `${p.filter || 'Jede App'} ${p.event === 'installed' ? 'installiert' : 'entfernt'}`,
    start(p, fire) {
      return sys('package', ({ event, pkg, app }) => {
        if (event !== p.event || !(has(pkg, p.filter) || has(app, p.filter))) return;
        fire({ info: app, data: { app_name: app, app_package: pkg } });
      });
    },
  });

  T('battery_temp', {
    name: 'Akkutemperatur', icon: 'device_thermostat', cat: 'power', supported: nativeOnly,
    help: 'Löst aus, wenn die Akkutemperatur einen Grenzwert über- oder unterschreitet. Magic Text: {battery_temp}.',
    params: [
      { key: 'dir', label: 'Wenn die Temperatur', type: 'select', options: [['above', 'über den Wert steigt'], ['below', 'unter den Wert fällt']], default: 'above' },
      { key: 'value', label: 'Grenzwert in °C', type: 'number', min: -20, max: 80, default: 40 },
    ],
    describe: (p) => `${p.dir === 'above' ? 'Steigt über' : 'Fällt unter'} ${p.value} °C`,
    start(p, fire) {
      let last = state().batteryTemp;
      return sys('battery_temp', ({ celsius }) => {
        const L = Number(p.value), prev = last;
        last = celsius;
        if (prev == null) return;
        const hit = p.dir === 'above' ? prev <= L && celsius > L : prev >= L && celsius < L;
        if (hit) fire({ info: celsius + ' °C', data: { battery_temp: celsius } });
      });
    },
  });

  // --- Kalender: Termine der nächsten Tage werden regelmäßig gelesen, der Android-Wecker weckt pünktlich
  function calendarMatch(p) {
    return (ev) => has(ev.title, p.title) && has(ev.calendar, p.calendar) && (p.allDay !== false || !ev.allDay);
  }
  T('calendar', {
    name: 'Kalendertermin beginnt/endet', icon: 'event', cat: 'datetime', supported: nativeOnly, needs: ['calendar'],
    help: 'Löst aus, wenn ein Termin beginnt oder endet – optional einige Minuten vorher oder nachher. Magic Text: {cal_title}, {cal_location}, {cal_description}.',
    params: [
      { key: 'event', label: 'Ereignis', type: 'select', options: [['start', 'Termin beginnt'], ['end', 'Termin endet']], default: 'start' },
      { key: 'title', label: 'Titel enthält (leer = jeder Termin)', type: 'text', default: '' },
      { key: 'calendar', label: 'Kalendername enthält (optional)', type: 'text', default: '' },
      { key: 'offset', label: 'Minuten vorher (negativ = nachher)', type: 'number', default: 0 },
      { key: 'allDay', label: 'Ganztägige Termine einbeziehen', type: 'bool', default: false },
    ],
    describe: (p) => `${p.title || 'Jeder Termin'} ${p.event === 'start' ? 'beginnt' : 'endet'}${Number(p.offset) ? ` (${Math.abs(p.offset)} min ${p.offset > 0 ? 'vorher' : 'nachher'})` : ''}`,
    start(p, fire, inst) {
      let events = [], loadedAt = 0;
      const load = () => {
        loadedAt = Date.now();
        try { events = MS.native.calendarEvents(Date.now() - 86400000, Date.now() + 3 * 86400000).filter(calendarMatch(p)); } catch (e) {
          events = [];
          MS.log('warn', 'Kalender: ' + e.message, 'System');
        }
      };
      const when = (ev) => (p.event === 'start' ? ev.begin : ev.end) - (Number(p.offset) || 0) * 60000;
      const plan = (now) => {
        const next = events.map(when).filter((t) => t > now).sort((a, b) => a - b)[0];
        due(inst, Math.min(next || Infinity, loadedAt + 10 * 60000));
      };
      load();
      plan(Date.now());
      return MS.bus.on('tick', ({ prev, now }) => {
        for (const ev of events) {
          const t = when(ev);
          if (t > +prev && t <= +now) fire({ info: ev.title, data: { cal_title: ev.title, cal_location: ev.location, cal_description: ev.description } });
        }
        if (+now - loadedAt > 10 * 60000) load();
        plan(+now);
      });
    },
  });

  T('nfc', {
    name: 'NFC-Tag', icon: 'nfc', cat: 'device', supported: nativeOnly,
    help: 'Löst aus, wenn ein mit Makro Studio beschriebener NFC-Tag ans entsperrte Handy gehalten wird. Den Tag einmal über „Tag beschreiben“ einrichten (App geöffnet lassen, Tag an die Rückseite halten). Magic Text: {nfc_tag}.',
    params: [
      { key: 'tag', label: 'Tag-Name', type: 'text', default: '', required: true },
      { type: 'button', label: 'NFC-Tag beschreiben', icon: 'nfc', nativeOnly: true, hint: 'Nach dem Tippen den Tag innerhalb von 30 Sekunden ans Handy halten.',
        async onClick(p) {
          if (!p.tag) throw new Error('Bitte zuerst einen Tag-Namen eingeben');
          MS.ui.toast('Jetzt den NFC-Tag ans Handy halten …', 4000, 'nfc');
          await MS.native.writeNfc(p.tag);
          return `Tag „${p.tag}“ beschrieben`;
        } },
    ],
    describe: (p) => `Tag „${p.tag}“`,
    start(p, fire) {
      return sys('nfc', ({ tag }) => { if (lc(tag) === lc(p.tag)) fire({ info: tag, data: { nfc_tag: tag } }); });
    },
  });

  // Schnelleinstellungs-Kacheln
  const tileUsers = new Map();
  const syncTiles = () => {
    if (!MS.native.available) return;
    for (const n of [1, 2, 3]) {
      const labels = [...tileUsers.values()].filter((u) => u.tile === n).map((u) => u.label);
      MS.native.setTileLabel(n, labels[0] || '');
    }
  };
  T('quick_tile', {
    name: 'Schnelleinstellungs-Kachel', icon: 'dashboard_customize', cat: 'device', supported: nativeOnly,
    help: 'Startet das Makro über eine Kachel in den Schnelleinstellungen (Statusleiste zweimal herunterziehen → Bearbeiten-Stift → Kachel „Makro 1–3“ hinzufügen).',
    params: [
      { key: 'tile', label: 'Kachel', type: 'select', options: [[1, 'Makro 1'], [2, 'Makro 2'], [3, 'Makro 3']], default: 1 },
      { key: 'label', label: 'Beschriftung', type: 'text', default: '' },
    ],
    describe: (p) => `Kachel ${p.tile}${p.label ? ` „${p.label}“` : ''}`,
    start(p, fire, inst) {
      const n = Number(p.tile) || 1;
      tileUsers.set(inst.id, { tile: n, label: p.label || 'Makro ' + n });
      syncTiles();
      const off = sys('tile', ({ tile }) => { if (Number(tile) === n) fire({ info: 'Kachel ' + n }); });
      return () => { off(); tileUsers.delete(inst.id); syncTiles(); };
    },
  });

  // Webhook: kleiner HTTP-Server im Handy, solange mindestens ein Webhook-Auslöser aktiv ist
  const webhookUsers = new Set();
  const webhookConfig = () => {
    const s = MS.store.state.settings;
    if (!s.webhookToken) {
      const b = new Uint8Array(12);
      crypto.getRandomValues(b);
      s.webhookToken = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      MS.store.save();
    }
    return { port: Number(s.webhookPort) || 8080, token: s.webhookToken };
  };
  const syncWebhook = () => {
    if (!MS.native.available) return;
    const c = webhookConfig();
    MS.native.setWebhook(webhookUsers.size ? c.port : 0, c.token);
  };
  if (MS.bus) sys('webhook_error', ({ error }) => MS.log('warn', 'Webhook-Server: ' + error, 'System'));
  T('webhook', {
    name: 'Webhook (HTTP-Aufruf)', icon: 'webhook', cat: 'app', supported: nativeOnly,
    help: 'Löst aus, wenn die angezeigte Adresse im lokalen Netz aufgerufen wird – z. B. von einem PC, Home Assistant oder einem anderen Handy im selben WLAN. Parameter der Adresse stehen als {wh_name} bereit, der Inhalt als {webhook_body}.',
    params: [
      { key: 'path', label: 'Name (Teil der Adresse)', type: 'text', default: 'makro', required: true },
      { key: 'var', label: 'Parameter als Wörterbuch speichern in (optional)', type: 'var', varTypes: ['dictionary'], optional: true },
      { type: 'info', text: (p) => {
        if (!MS.native.available) return 'Nur in der Android-App.';
        const c = webhookConfig();
        const ips = MS.native.localIps();
        return `Adresse: http://${ips[0] || '<handy-ip>'}:${c.port}/${p.path || 'makro'}?token=${c.token}` + (ips.length > 1 ? ` (weitere IPs: ${ips.slice(1).join(', ')})` : '');
      } },
    ],
    describe: (p) => '/' + p.path,
    start(p, fire, inst) {
      webhookUsers.add(inst.id);
      syncWebhook();
      const off = sys('webhook', (e) => {
        if (lc(e.path) !== lc(p.path)) return;
        const data = { webhook_body: e.body, webhook_path: e.path, webhook_from: e.from };
        for (const [k, v] of Object.entries(e.query || {})) data['wh_' + k] = v;
        fire({ info: `${e.method} von ${e.from}`, data });
        if (p.var) MS.vars.set(p.var, e.query || {});
      });
      return () => { off(); webhookUsers.delete(inst.id); syncWebhook(); };
    },
  });

  T('dark_mode', {
    name: 'Dunkles Design umgeschaltet', icon: 'dark_mode', cat: 'device',
    help: 'Löst aus, wenn das System zwischen hellem und dunklem Design wechselt.',
    params: [{ key: 'state', label: 'Ereignis', type: 'select', options: [['dark', 'Dunkel eingeschaltet'], ['light', 'Hell eingeschaltet']], default: 'dark' }],
    describe: (p) => (p.state === 'dark' ? 'Wechsel zu dunkel' : 'Wechsel zu hell'),
    start(p, fire) { return MS.bus.on('dark-mode', ({ dark }) => { if (dark === (p.state === 'dark')) fire({ info: dark ? 'dunkel' : 'hell' }); }); },
  });

  // Homescreen-Verknüpfung für den bestehenden URL-Auslöser
  const shortcut = MS.catalog.triggers.shortcut;
  if (shortcut) {
    shortcut.params.push({ type: 'button', label: 'Zum Startbildschirm hinzufügen', icon: 'add_to_home_screen', nativeOnly: true,
      onClick: (p, ctx) => {
        if (!ctx.item) throw new Error('Bitte den Auslöser zuerst speichern');
        MS.native.pinShortcut(ctx.item.id, ctx.macroName || 'Makro');
        return 'Verknüpfung angefragt – bitte bestätigen';
      } });
  }

  // ================================================================ AKTIONEN
  A('call_direct', {
    name: 'Direkt anrufen', icon: 'phone_forwarded', cat: 'phone', supported: nativeOnly, needs: ['phone'],
    help: 'Ruft eine Nummer sofort an (ohne die Telefon-App zu öffnen).',
    params: [{ key: 'number', label: 'Telefonnummer', type: 'text', magic: true, default: '', required: true }],
    describe: (p) => p.number,
    run: (ctx, p) => MS.native.callNumber(M(p.number, ctx).replace(/\s/g, '')),
  });

  A('call_control', {
    name: 'Anruf annehmen/beenden', icon: 'call_end', cat: 'phone', supported: nativeOnly, needs: ['phone'],
    help: 'Nimmt einen klingelnden Anruf an oder beendet bzw. lehnt den aktuellen Anruf ab (ab Android 9).',
    params: [{ key: 'action', label: 'Aktion', type: 'select', options: [['answer', 'Annehmen'], ['end', 'Beenden / ablehnen']], default: 'end' }],
    describe: (p) => (p.action === 'answer' ? 'Annehmen' : 'Beenden / ablehnen'),
    run: (ctx, p) => MS.native.callControl(p.action),
  });

  A('sms_send', {
    name: 'SMS senden', icon: 'send', cat: 'phone', supported: nativeOnly, needs: ['sms'],
    help: 'Sendet eine SMS direkt im Hintergrund (es können Kosten entstehen).',
    params: [
      { key: 'number', label: 'Empfänger', type: 'text', magic: true, default: '', required: true },
      { key: 'text', label: 'Nachricht', type: 'textarea', magic: true, default: '' },
    ],
    describe: (p) => `${p.number}: ${p.text}`,
    run: (ctx, p) => MS.native.sendSms(M(p.number, ctx).replace(/\s/g, ''), M(p.text, ctx)),
  });

  A('notification_dismiss', {
    name: 'Benachrichtigung schließen', icon: 'notifications_off', cat: 'notify', supported: nativeOnly, needs: ['notification_listener'],
    help: 'Entfernt Benachrichtigungen anderer Apps. Benötigt den Benachrichtigungszugriff.',
    params: [
      { key: 'anyApp', label: 'Von jeder App', type: 'bool', default: false },
      { key: 'app', label: 'App', type: 'app', showIf: (p) => !p.anyApp },
      { key: 'contains', label: 'Titel oder Text enthält (optional)', type: 'text', magic: true, default: '' },
    ],
    describe: (p) => `${p.anyApp ? 'Jede App' : appName(p)}${p.contains ? ` · „${p.contains}“` : ''}`,
    run: (ctx, p) => MS.native.notificationDismiss(p.anyApp ? '' : p.app, M(p.contains, ctx)),
  });

  A('notification_press', {
    name: 'Benachrichtigung antippen / Knopf drücken', icon: 'ads_click', cat: 'notify', supported: nativeOnly, needs: ['notification_listener'],
    help: 'Öffnet eine Benachrichtigung oder drückt einen ihrer Knöpfe (z. B. „Als gelesen markieren“).',
    params: [
      { key: 'anyApp', label: 'Von jeder App', type: 'bool', default: false },
      { key: 'app', label: 'App', type: 'app', showIf: (p) => !p.anyApp },
      { key: 'contains', label: 'Titel oder Text enthält (optional)', type: 'text', magic: true, default: '' },
      { key: 'button', label: 'Knopf (leer = Benachrichtigung selbst öffnen)', type: 'text', magic: true, default: '' },
    ],
    describe: (p) => `${p.anyApp ? 'Jede App' : appName(p)}${p.button ? ` · Knopf „${p.button}“` : ' · öffnen'}`,
    run: (ctx, p) => MS.native.notificationPress(p.anyApp ? '' : p.app, M(p.contains, ctx), M(p.button, ctx)),
  });

  A('read_screen', {
    name: 'Bildschirmtext auslesen', icon: 'text_snippet', cat: 'device', supported: nativeOnly, needs: ['accessibility'],
    help: 'Speichert alle sichtbaren Texte des Bildschirms (eine Zeile pro Element) in einer Variable. Benötigt die Bedienungshilfe.',
    params: [{ key: 'var', label: 'Speichern in', type: 'var', varTypes: ['string'], required: true }],
    describe: (p) => '→ ' + varName(p.var),
    run: (ctx, p) => store(p.var, MS.native.screenText(), ctx),
  });

  A('ocr', {
    name: 'Texterkennung (OCR)', icon: 'document_scanner', cat: 'device', supported: nativeOnly, needs: ['accessibility'],
    help: 'Erkennt Text auf einem Screenshot – auch in Bildern und Spielen, wo „Bildschirmtext auslesen“ nichts findet. Benötigt die Bedienungshilfe (Android 11+) und die Google-Play-Dienste.',
    params: [
      { key: 'region', label: 'Bereich x,y,Breite,Höhe in Pixeln (leer = ganzer Bildschirm)', type: 'text', magic: true, default: '' },
      { key: 'var', label: 'Speichern in', type: 'var', varTypes: ['string'], required: true },
    ],
    describe: (p) => `${p.region ? 'Bereich ' + p.region : 'Ganzer Bildschirm'} → ${varName(p.var)}`,
    async run(ctx, p) { store(p.var, await MS.native.ocr(M(p.region, ctx).replace(/\s/g, '')), ctx); },
  });

  const FILE_OPS = [['write', 'Schreiben (ersetzen)'], ['append', 'Anhängen'], ['read', 'Lesen'], ['exists', 'Existiert?'], ['delete', 'Löschen'], ['list', 'Dateien auflisten']];
  A('file', {
    name: 'Datei schreiben/lesen', icon: 'description', cat: 'files', supported: nativeOnly,
    help: 'Schreibt, ergänzt, liest oder löscht eine Textdatei in einem freigegebenen Ordner. Den Ordner einmal auswählen – die Freigabe bleibt bestehen.',
    params: [
      { key: 'folder', label: 'Ordner', type: 'folder', required: true },
      { key: 'op', label: 'Vorgang', type: 'select', options: FILE_OPS, default: 'append' },
      { key: 'name', label: 'Dateiname', type: 'text', magic: true, default: 'log.txt', showIf: (p) => p.op !== 'list' },
      { key: 'text', label: 'Text', type: 'textarea', magic: true, default: '{date} {time}{newline}', showIf: (p) => p.op === 'write' || p.op === 'append' },
      { key: 'var', label: 'Ergebnis speichern in', type: 'var', optional: true, showIf: (p) => ['read', 'exists', 'list'].includes(p.op) },
    ],
    describe: (p) => `${opt(FILE_OPS, p.op)}${p.op !== 'list' ? ': ' + p.name : ''}`,
    run(ctx, p) {
      const r = MS.native.fileOp(p.folder, M(p.name, ctx), p.op, M(p.text, ctx));
      store(p.var, r, ctx);
    },
  });

  A('email_send', {
    name: 'E-Mail senden (SMTP)', icon: 'forward_to_inbox', cat: 'phone', supported: nativeOnly,
    help: 'Sendet eine E-Mail direkt über deinen Mailserver, ohne E-Mail-App. Bei Gmail ein App-Passwort verwenden (smtp.gmail.com, Port 465, SSL). Achtung: Das Passwort wird im Makro gespeichert und beim Exportieren mitgegeben.',
    params: [
      { key: 'to', label: 'An (mehrere mit Komma)', type: 'text', magic: true, default: '', required: true },
      { key: 'subject', label: 'Betreff', type: 'text', magic: true, default: '' },
      { key: 'body', label: 'Nachricht', type: 'textarea', magic: true, default: '' },
      { key: 'host', label: 'SMTP-Server', type: 'text', default: 'smtp.gmail.com', required: true },
      { key: 'port', label: 'Port', type: 'number', default: 465 },
      { key: 'security', label: 'Verschlüsselung', type: 'select', options: [['ssl', 'SSL/TLS (Port 465)'], ['starttls', 'STARTTLS (Port 587)']], default: 'ssl' },
      { key: 'user', label: 'Benutzername', type: 'text', default: '' },
      { key: 'password', label: 'Passwort / App-Passwort', type: 'text', default: '' },
      { key: 'from', label: 'Absender (leer = Benutzername)', type: 'text', default: '' },
    ],
    describe: (p) => `${p.to}: ${p.subject}`,
    run: (ctx, p) => MS.native.sendMail({
      host: p.host, port: Number(p.port) || 465, security: p.security, user: p.user, password: p.password,
      from: p.from || p.user, to: M(p.to, ctx), subject: M(p.subject, ctx), body: M(p.body, ctx),
    }),
  });

  A('calendar_add', {
    name: 'Kalendertermin anlegen', icon: 'event_available', cat: 'apps', supported: nativeOnly, needs: ['calendar'],
    help: 'Trägt einen Termin in den Hauptkalender ein. Datum als JJJJ-MM-TT (leer = heute) oder „+1“ für morgen.',
    params: [
      { key: 'title', label: 'Titel', type: 'text', magic: true, default: '', required: true },
      { key: 'date', label: 'Datum (JJJJ-MM-TT, +Tage oder leer = heute)', type: 'text', magic: true, default: '' },
      { key: 'allDay', label: 'Ganztägig', type: 'bool', default: false },
      { key: 'time', label: 'Beginn', type: 'time', default: '12:00', showIf: (p) => !p.allDay },
      { key: 'duration', label: 'Dauer in Minuten', type: 'number', min: 1, default: 60, showIf: (p) => !p.allDay },
      { key: 'location', label: 'Ort', type: 'text', magic: true, default: '' },
      { key: 'description', label: 'Beschreibung', type: 'textarea', magic: true, default: '' },
    ],
    describe: (p) => `${p.title} · ${p.date || 'heute'}${p.allDay ? '' : ' ' + p.time}`,
    run(ctx, p) {
      const ds = M(p.date, ctx).trim();
      let day = new Date();
      if (/^\+?-?\d+$/.test(ds)) day.setDate(day.getDate() + Number(ds));
      else if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) { const [y, m, d] = ds.split('-').map(Number); day = new Date(y, m - 1, d); }
      else if (ds) throw new Error('Ungültiges Datum: ' + ds);
      let begin, end;
      if (p.allDay) {
        begin = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
        end = begin + 86400000;
      } else {
        const [hh, mm] = String(p.time || '12:00').split(':').map(Number);
        begin = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm).getTime();
        end = begin + (Number(p.duration) || 60) * 60000;
      }
      MS.native.calendarAdd({ title: M(p.title, ctx), description: M(p.description, ctx), location: M(p.location, ctx), begin, end, allDay: !!p.allDay });
    },
  });

  const WALL = [['both', 'Startbildschirm und Sperrbildschirm'], ['home', 'Nur Startbildschirm'], ['lock', 'Nur Sperrbildschirm']];
  A('wallpaper', {
    name: 'Hintergrundbild setzen', icon: 'wallpaper', cat: 'device', supported: nativeOnly,
    help: 'Setzt ein Bild als Hintergrund.',
    params: [
      { key: 'image', label: 'Bild', type: 'image', required: true },
      { key: 'which', label: 'Für', type: 'select', options: WALL, default: 'both' },
    ],
    describe: (p) => opt(WALL, p.which),
    run: (ctx, p) => MS.native.setWallpaper(p.image, p.which),
  });

  const POS = [['top', 'Oben'], ['center', 'Mitte'], ['bottom', 'Unten']];
  A('overlay_text', {
    name: 'Text einblenden (über allen Apps)', icon: 'subtitles', cat: 'notify', supported: nativeOnly, needs: ['overlay'],
    help: 'Zeigt einen Text über allen Apps an – z. B. einen Zähler oder Status. Leerer Text blendet ihn aus.',
    params: [
      { key: 'text', label: 'Text (leer = ausblenden)', type: 'textarea', magic: true, default: '' },
      { key: 'seconds', label: 'Anzeigedauer in Sekunden (0 = dauerhaft)', type: 'number', min: 0, default: 5 },
      { key: 'position', label: 'Position', type: 'select', options: POS, default: 'top' },
      { key: 'size', label: 'Schriftgröße', type: 'number', min: 8, max: 64, default: 18 },
      { key: 'color', label: 'Textfarbe', type: 'color', default: '#ffffff' },
      { key: 'background', label: 'Hintergrund', type: 'color', default: '#202124' },
    ],
    describe: (p) => (p.text ? `„${p.text}“ ${p.seconds > 0 ? p.seconds + ' s' : 'dauerhaft'}` : 'Ausblenden'),
    run: (ctx, p) => MS.native.overlayText(M(p.text, ctx), p.seconds, p.position, p.size, p.color, p.background),
  });

  const TIMEOUTS = [[15, '15 Sekunden'], [30, '30 Sekunden'], [60, '1 Minute'], [120, '2 Minuten'], [300, '5 Minuten'], [600, '10 Minuten'], [1800, '30 Minuten']];
  A('screen_timeout', {
    name: 'Bildschirm-Timeout', icon: 'timer_off', cat: 'device', supported: nativeOnly, needs: ['write_settings'],
    help: 'Stellt ein, nach welcher Zeit sich der Bildschirm ausschaltet.',
    params: [{ key: 'seconds', label: 'Ausschalten nach', type: 'select', options: TIMEOUTS, default: 60 }],
    describe: (p) => opt(TIMEOUTS, Number(p.seconds)),
    run: (ctx, p) => MS.native.setSystemSetting('screen_timeout', Number(p.seconds) * 1000),
  });

  A('auto_rotate', {
    name: 'Automatisch drehen', icon: 'screen_rotation', cat: 'device', supported: nativeOnly, needs: ['write_settings'],
    params: [{ key: 'state', label: 'Automatisch drehen', type: 'select', options: [['on', 'Ein'], ['off', 'Aus'], ['toggle', 'Umschalten']], default: 'toggle' }],
    describe: (p) => ({ on: 'Ein', off: 'Aus', toggle: 'Umschalten' })[p.state],
    run(ctx, p) {
      const on = p.state === 'toggle' ? MS.native.getSystemSetting('auto_rotate') !== 1 : p.state === 'on';
      MS.native.setSystemSetting('auto_rotate', on ? 1 : 0);
    },
  });

  const PANELS = [['wifi', 'WLAN'], ['internet', 'Internet (WLAN & mobile Daten)'], ['bluetooth', 'Bluetooth'], ['airplane', 'Flugmodus'], ['nfc', 'NFC'], ['volume', 'Lautstärke'], ['location', 'Standort'], ['hotspot', 'Netzwerk & Hotspot'], ['data', 'Mobile Daten'], ['display', 'Display'], ['battery', 'Akku'], ['settings', 'Einstellungen']];
  A('settings_panel', {
    name: 'Einstellungs-Panel öffnen', icon: 'settings', cat: 'device', supported: nativeOnly, needs: ['overlay|accessibility'],
    help: 'Öffnet ein Schnell-Panel bzw. die Einstellungsseite – Android erlaubt Apps nicht, WLAN, mobile Daten, Bluetooth oder Flugmodus selbst zu schalten. Mit „UI-Interaktion“ danach kann der Schalter angetippt werden.',
    params: [{ key: 'panel', label: 'Panel', type: 'select', options: PANELS, default: 'wifi' }],
    describe: (p) => opt(PANELS, p.panel),
    run: (ctx, p) => MS.native.openPanel(p.panel),
  });

  A('shell', {
    name: 'Shell-Befehl', icon: 'terminal', cat: 'files', supported: nativeOnly,
    help: 'Führt einen Linux-Befehl aus. Ohne Root sind nur einfache Befehle erlaubt; mit Root (gerootetes Gerät) fast alles. Magic Text im Befehl wird ersetzt.',
    params: [
      { key: 'command', label: 'Befehl', type: 'textarea', magic: true, default: 'date', required: true },
      { key: 'root', label: 'Als Root ausführen (su)', type: 'bool', default: false },
      { key: 'timeout', label: 'Zeitlimit in Sekunden', type: 'number', min: 1, max: 600, default: 30 },
      { key: 'var', label: 'Ausgabe speichern in (optional)', type: 'var', optional: true },
      { key: 'codeVar', label: 'Rückgabecode speichern in (optional)', type: 'var', varTypes: ['integer', 'decimal', 'string'], optional: true },
    ],
    describe: (p) => (p.root ? '# ' : '$ ') + p.command,
    async run(ctx, p) {
      const r = await MS.native.shell(M(p.command, ctx), p.root, p.timeout);
      store(p.var, r.out + (r.err ? (r.out ? '\n' : '') + r.err : ''), ctx);
      store(p.codeVar, r.code, ctx);
      if (r.error) MS.log('warn', 'Shell: ' + r.error, ctx.macroName);
    },
  });

  A('speech_input', {
    name: 'Spracheingabe', icon: 'mic', cat: 'dialogs', supported: nativeOnly,
    help: 'Hört zu und speichert den erkannten Text in einer Variable. Funktioniert nur, während Makro Studio geöffnet ist.',
    params: [
      { key: 'prompt', label: 'Hinweis', type: 'text', magic: true, default: 'Sprich jetzt …' },
      { key: 'lang', label: 'Sprache', type: 'select', options: [['', 'Gerätesprache'], ['de-DE', 'Deutsch'], ['en-US', 'Englisch'], ['fr-FR', 'Französisch'], ['es-ES', 'Spanisch'], ['it-IT', 'Italienisch']], default: '' },
      { key: 'var', label: 'Speichern in', type: 'var', required: true },
      { key: 'onCancel', label: 'Bei Abbruch', type: 'select', options: [['continue', 'Makro fortsetzen'], ['stop', 'Makro beenden']], default: 'stop' },
    ],
    describe: (p) => '→ ' + varName(p.var),
    async run(ctx, p) {
      const text = await MS.native.speechInput(p.lang, M(p.prompt, ctx));
      if (text === null || text === '') { if (p.onCancel === 'stop') ctx.stop('Spracheingabe abgebrochen'); return; }
      store(p.var, text, ctx);
    },
  });

  // --- Variablen & JSON (auch im Browser)
  function getPath(obj, path) {
    let cur = obj;
    for (const part of String(path).match(/[^.[\]]+/g) || []) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part];
    }
    return cur;
  }
  A('json_parse', {
    name: 'JSON auswerten', icon: 'data_object', cat: 'vars',
    help: 'Liest JSON (z. B. die Antwort einer HTTP-Anfrage) in ein Wörterbuch oder holt einen einzelnen Wert per Pfad wie daten.liste[0].name.',
    params: [
      { key: 'source', label: 'JSON-Text', type: 'textarea', magic: true, default: '{v=antwort}', required: true },
      { key: 'path', label: 'Pfad (leer = alles)', type: 'text', magic: true, default: '' },
      { key: 'var', label: 'Speichern in', type: 'var', required: true },
    ],
    describe: (p) => `${p.path || 'JSON'} → ${varName(p.var)}`,
    run(ctx, p) {
      let data;
      try { data = JSON.parse(M(p.source, ctx)); } catch (e) { throw new Error('Kein gültiges JSON: ' + e.message); }
      const path = M(p.path, ctx).trim();
      const v = path ? getPath(data, path) : data;
      if (v === undefined) throw new Error(`Pfad „${path}“ nicht gefunden`);
      store(p.var, v !== null && typeof v === 'object' && MS.vars.resolve(p.var, ctx)?.type !== 'dictionary' ? JSON.stringify(v) : v, ctx);
    },
  });

  const DICT_OPS = [['remove', 'Eintrag entfernen'], ['clear', 'Alle Einträge löschen'], ['count', 'Anzahl der Einträge'], ['keys', 'Schlüssel auflisten'], ['has', 'Schlüssel vorhanden?']];
  A('dict_edit', {
    name: 'Wörterbuch bearbeiten', icon: 'menu_book', cat: 'vars',
    help: 'Entfernt Einträge eines Wörterbuchs, leert es oder liest Anzahl bzw. Schlüssel aus. Zum Setzen „Variable setzen“ mit Eintrag verwenden.',
    params: [
      { key: 'var', label: 'Wörterbuch', type: 'var', varTypes: ['dictionary'], required: true },
      { key: 'op', label: 'Vorgang', type: 'select', options: DICT_OPS, default: 'remove' },
      { key: 'key', label: 'Eintrag, z. B. [Buttons][ok]', type: 'text', magic: true, default: '', showIf: (p) => p.op === 'remove' || p.op === 'has' },
      { key: 'out', label: 'Ergebnis speichern in', type: 'var', showIf: (p) => ['count', 'keys', 'has'].includes(p.op) },
    ],
    describe: (p) => `${varName(p.var)}: ${opt(DICT_OPS, p.op)}${p.key && (p.op === 'remove' || p.op === 'has') ? ' ' + p.key : ''}`,
    run(ctx, p) {
      const v = MS.vars.resolve(p.var, ctx);
      if (!v) throw new Error(`Variable „${varName(p.var)}“ nicht gefunden`);
      const dict = v.value && typeof v.value === 'object' ? v.value : {};
      const keys = MS.vars.parsePath('_' + M(p.key, ctx)).keys;
      const parent = keys.slice(0, -1).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict);
      const last = keys[keys.length - 1];
      switch (p.op) {
        case 'remove':
          if (parent && typeof parent === 'object' && last !== undefined) delete parent[last];
          MS.vars.set(p.var, dict, ctx);
          MS.store.save();
          break;
        case 'clear': MS.vars.set(p.var, {}, ctx); break;
        case 'count': store(p.out, Object.keys(dict).length, ctx); break;
        case 'keys': store(p.out, Object.keys(dict).join('\n'), ctx); break;
        case 'has': store(p.out, !!(parent && typeof parent === 'object' && last in parent), ctx); break;
      }
    },
  });

  const SW_OPS = [['start', 'Starten / fortsetzen'], ['pause', 'Anhalten'], ['reset', 'Zurücksetzen'], ['read', 'Zeit auslesen']];
  A('stopwatch', {
    name: 'Stoppuhr', icon: 'timer', cat: 'vars',
    help: 'Misst Zeiten über mehrere Makro-Läufe hinweg. Die Zeit kann in eine Variable gelesen werden.',
    params: [
      { key: 'name', label: 'Name der Stoppuhr', type: 'text', default: 'Stoppuhr', required: true },
      { key: 'op', label: 'Vorgang', type: 'select', options: SW_OPS, default: 'start' },
      { key: 'unit', label: 'Einheit', type: 'select', options: UNIT_OPTIONS, default: 's', showIf: (p) => p.op === 'read' },
      { key: 'var', label: 'Speichern in', type: 'var', varTypes: ['integer', 'decimal', 'string'], showIf: (p) => p.op === 'read' },
    ],
    describe: (p) => `${p.name}: ${opt(SW_OPS, p.op)}${p.op === 'read' && p.var ? ' → ' + varName(p.var) : ''}`,
    run(ctx, p) {
      const all = (MS.store.state.stopwatches = MS.store.state.stopwatches || {});
      const sw = (all[p.name] = all[p.name] || { elapsed: 0, since: null });
      const now = Date.now();
      const total = () => sw.elapsed + (sw.since ? now - sw.since : 0);
      switch (p.op) {
        case 'start': if (!sw.since) sw.since = now; break;
        case 'pause': sw.elapsed = total(); sw.since = null; break;
        case 'reset': sw.elapsed = 0; sw.since = sw.since ? now : null; break;
        case 'read': {
          const v = total() / (UNIT_MS[p.unit] || 1000);
          store(p.var, p.unit === 'ms' ? Math.round(v) : Math.round(v * 100) / 100, ctx);
          break;
        }
      }
      MS.store.save();
    },
  });

  // ================================================================ BEDINGUNGEN
  C('wifi_ssid', {
    name: 'WLAN-Netz', icon: 'wifi_find', cat: 'device', supported: nativeOnly, needs: ['location'],
    help: 'Prüft, ob das Handy mit einem bestimmten WLAN verbunden ist (benötigt Standortberechtigung und eingeschalteten Standort).',
    params: [
      { key: 'state', label: 'Zustand', type: 'select', options: [['connected', 'Verbunden mit'], ['not', 'Nicht verbunden mit']], default: 'connected' },
      { key: 'ssid', label: 'WLAN-Name (leer = irgendein WLAN, mehrere mit Komma)', type: 'text', default: '' },
    ],
    describe: (p) => `${p.state === 'connected' ? 'Verbunden mit' : 'Nicht verbunden mit'} ${p.ssid || 'WLAN'}`,
    check(ctx, p) {
      const n = state().network || {};
      const names = String(p.ssid || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const on = n.type === 'wifi' && (!names.length || names.includes(lc(n.ssid)));
      return on === (p.state === 'connected');
    },
  });
  C('network_type', {
    name: 'Netzwerkart', icon: 'signal_cellular_alt', cat: 'device', supported: nativeOnly,
    params: [{ key: 'type', label: 'Aktuelle Verbindung ist', type: 'select', options: NET_TYPES, default: 'wifi' }],
    describe: (p) => 'Verbindung: ' + opt(NET_TYPES, p.type),
    check: (ctx, p) => (state().network || {}).type === p.type,
  });
  C('headphones', {
    name: 'Kopfhörer verbunden', icon: 'headphones', cat: 'device', supported: nativeOnly,
    params: [{ key: 'state', label: 'Kopfhörer', type: 'select', options: [['yes', 'Verbunden'], ['no', 'Nicht verbunden']], default: 'yes' }],
    describe: (p) => (p.state === 'yes' ? 'Kopfhörer verbunden' : 'Keine Kopfhörer'),
    check: (ctx, p) => !!state().headphones === (p.state === 'yes'),
  });
  C('screen_on', {
    name: 'Bildschirm an', icon: 'phone_android', cat: 'device', supported: nativeOnly,
    params: [{ key: 'state', label: 'Bildschirm ist', type: 'select', options: [['on', 'An'], ['off', 'Aus']], default: 'on' }],
    describe: (p) => `Bildschirm ${p.state === 'on' ? 'an' : 'aus'}`,
    check: (ctx, p) => !!state().screenOn === (p.state === 'on'),
  });
  const CALL_STATES = [['idle', 'Kein Anruf'], ['ringing', 'Es klingelt'], ['offhook', 'Im Gespräch']];
  C('call_state', {
    name: 'Telefonstatus', icon: 'call', cat: 'device', supported: nativeOnly, needs: ['phone'],
    params: [{ key: 'state', label: 'Status', type: 'select', options: CALL_STATES, default: 'idle' }],
    describe: (p) => opt(CALL_STATES, p.state),
    check: (ctx, p) => (state().call || 'idle') === p.state,
  });
  const RADIO_KEYS = { wifi_state: 'wifiOn', bt_state: 'btOn', airplane: 'airplane', power_save: 'powerSave' };
  C('radio_state', {
    name: 'WLAN/Bluetooth/Flugmodus', icon: 'toggle_on', cat: 'device', supported: nativeOnly,
    params: [
      { key: 'radio', label: 'Funktion', type: 'select', options: RADIOS, default: 'wifi_state' },
      { key: 'state', label: 'Ist', type: 'select', options: [['on', 'Eingeschaltet'], ['off', 'Ausgeschaltet']], default: 'on' },
    ],
    describe: (p) => `${opt(RADIOS, p.radio)} ${p.state === 'on' ? 'an' : 'aus'}`,
    check: (ctx, p) => !!state()[RADIO_KEYS[p.radio]] === (p.state === 'on'),
  });
  C('battery_temp', {
    name: 'Akkutemperatur', icon: 'device_thermostat', cat: 'power', supported: nativeOnly,
    params: [
      { key: 'op', label: 'Temperatur', type: 'select', options: [['above', 'über'], ['below', 'unter']], default: 'above' },
      { key: 'value', label: '°C', type: 'number', default: 40 },
    ],
    describe: (p) => `Akku ${p.op === 'above' ? 'über' : 'unter'} ${p.value} °C`,
    check(ctx, p) {
      const t = Number(state().batteryTemp);
      return p.op === 'above' ? t > Number(p.value) : t < Number(p.value);
    },
  });
  C('calendar_event', {
    name: 'Termin läuft gerade', icon: 'event', cat: 'datetime', supported: nativeOnly, needs: ['calendar'],
    params: [
      { key: 'title', label: 'Titel enthält (leer = jeder Termin)', type: 'text', default: '' },
      { key: 'calendar', label: 'Kalendername enthält (optional)', type: 'text', default: '' },
      { key: 'allDay', label: 'Ganztägige Termine einbeziehen', type: 'bool', default: false },
    ],
    describe: (p) => `Termin ${p.title ? `„${p.title}“ ` : ''}läuft`,
    check(ctx, p) {
      const now = Date.now();
      try {
        return MS.native.calendarEvents(now - 1, now + 1).filter(calendarMatch(p)).some((ev) => ev.begin <= now && ev.end > now);
      } catch (e) { return false; }
    },
  });

  // ================================================================ Schleife „für jeden Eintrag“
  const loop = MS.catalog.actions.loop;
  if (loop) {
    loop.params[0].options.push(['foreach', 'Für jeden Eintrag (Wörterbuch/Liste)']);
    loop.params.splice(2, 0, { key: 'var', label: 'Wörterbuch oder Text (eine Zeile pro Eintrag)', type: 'var', showIf: (p) => p.mode === 'foreach' });
    const d = loop.describe;
    loop.describe = (p) => (p.mode === 'foreach' ? `Für jeden Eintrag in ${varName(p.var)}` : d(p));
    loop.help += ' „Für jeden Eintrag“ stellt {loop_key} und {loop_value} bereit.';
  }

  // Neue Magic-Text-Platzhalter
  MS.magic.TOKENS.push(
    ['{call_number}', 'Anruf: Nummer'], ['{sms_from}', 'SMS: Absender'], ['{sms_text}', 'SMS: Text'],
    ['{ssid}', 'WLAN-Name'], ['{network_type}', 'Netzwerkart'], ['{headphones_name}', 'Kopfhörer'],
    ['{battery_temp}', 'Akkutemperatur'], ['{cal_title}', 'Termin: Titel'], ['{cal_location}', 'Termin: Ort'],
    ['{nfc_tag}', 'NFC-Tag'], ['{webhook_body}', 'Webhook: Inhalt'], ['{loop_key}', 'Schleife: Schlüssel'], ['{loop_value}', 'Schleife: Wert'],
  );
  MS.magic.live = {
    ssid: () => (state().network || {}).ssid || '',
    network_type: () => opt(NET_TYPES, (state().network || {}).type || 'none'),
    battery_temp: () => state().batteryTemp ?? '',
  };
})();
