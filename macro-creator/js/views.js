/* Makro Studio – Ansichten: Start, Makroliste, Makro-Editor, Vorlagen,
 * Variablen, Action Blocks, Protokoll und Einstellungen. */
'use strict';
(function () {
  const MS = window.MS;
  const { h, icon } = MS.ui;
  const ui = MS.ui;
  const { clone, uid, fmtTime, fmtDateTime } = MS.util;
  const S = () => MS.store.state;
  const go = (hash) => MS.app.navigate(hash);
  /** replaceChildren ohne null/false-Einträge */
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(Boolean));
  const views = (MS.views = {});

  /** Zeichnet neu, sobald eines der Ereignisse eintritt; gibt Abmeldefunktion zurück. */
  function live(draw, events) {
    draw();
    const offs = events.map((e) => MS.bus.on(e, draw));
    return () => offs.forEach((f) => f());
  }
  const switchEl = (checked, onchange, label) => {
    const cb = h('input', { type: 'checkbox', checked, 'aria-label': label || 'Ein/Aus', onchange: (e) => onchange(e.target.checked) });
    return h('label', { class: 'switch', onclick: (e) => e.stopPropagation() }, cb, h('span', { class: 'slider' }));
  };
  const fab = (ic, label, onclick, extra) => h('button', { class: 'fab' + (extra ? ' ' + extra : ''), type: 'button', 'aria-label': label, title: label, onclick }, icon(ic), h('span', { class: 'fab-label' }, label));
  const emptyState = (ic, title, text, ...buttons) => h('div', { class: 'empty-state' }, h('div', { class: 'empty-icon' }, icon(ic)), h('h3', null, title), h('p', null, text), h('div', { class: 'empty-actions' }, buttons));
  const relTime = (t) => {
    if (!t) return 'nie';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'gerade eben';
    if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
    if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
    return new Date(t).toLocaleDateString('de-DE');
  };

  // ------------------------------------------------------- Import / Export
  function download(filename, data) {
    if (MS.native.available) { MS.native.saveFile(filename, JSON.stringify(data, null, 2)); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const fileSafe = (s) => (s || 'makro').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_') || 'makro';

  function exportMacros(macros, filename) {
    const json = JSON.stringify(macros);
    const variables = S().variables.filter((v) => json.includes(`"g:${v.name}"`) || json.includes(`{v=${v.name}}`));
    const blocks = S().blocks.filter((b) => json.includes(`"${b.id}"`));
    download(filename, { app: 'makrostudio', version: 1, macros, variables, blocks });
  }

  function pickFile() {
    return new Promise((resolve) => {
      // In der Android-App keinen Dateityp vorgeben, sonst blendet die Dateiauswahl .macro-Dateien aus
      const input = h('input', { type: 'file', accept: MS.native.available ? null : '.json,.macro,.mdr,application/json', style: { display: 'none' } });
      input.addEventListener('change', () => {
        const f = input.files[0];
        input.remove();
        if (!f) return resolve(null);
        f.text().then(resolve, () => resolve(null));
      });
      document.body.append(input);
      input.click();
    });
  }

  async function importData() {
    const text = await pickFile();
    if (!text) return;
    let data;
    try { data = JSON.parse(text); } catch (e) { ui.alert('Import fehlgeschlagen', 'Die Datei ist kein gültiges JSON.'); return; }
    if (MS.macrodroid.isMacroDroid(data)) { importMacroDroid(data); return; }
    if (!data || (!Array.isArray(data.macros) && !Array.isArray(data.blocks))) { ui.alert('Import fehlgeschlagen', 'Keine Makros in der Datei gefunden. Unterstützt werden Makro Studio-Exporte (.json) und MacroDroid-Dateien (.macro).'); return; }
    // Kollidierende IDs neu vergeben und Verweise anpassen
    const taken = new Set([...S().macros, ...S().blocks].map((x) => x.id));
    let json = JSON.stringify({ macros: data.macros || [], blocks: data.blocks || [] });
    for (const x of [...(data.macros || []), ...(data.blocks || [])]) {
      if (x && taken.has(x.id)) json = json.split(`"${x.id}"`).join(`"${uid()}"`);
    }
    const { macros, blocks } = JSON.parse(json);
    for (const v of data.variables || []) {
      if (v && v.name && !S().variables.some((x) => x.name === v.name)) S().variables.push(v);
    }
    blocks.forEach((b) => S().blocks.push(b));
    macros.forEach((m) => { m.enabled = m.enabled !== false; S().macros.push(m); MS.store.ensureCategory(m.category); });
    MS.store.changed('all');
    ui.toast(`${macros.length} Makro(s) und ${blocks.length} Action Block(s) importiert`);
  }
  views.importData = importData;

  /** Import aus MacroDroid mit Bericht, was übernommen wurde. */
  async function importMacroDroid(data) {
    let res;
    try { res = MS.macrodroid.convert(data); } catch (e) { ui.alert('Import fehlgeschlagen', 'Die MacroDroid-Datei konnte nicht gelesen werden: ' + e.message); return; }
    const total = res.report.reduce((n, x) => n + x.missing.length + x.check.length, 0);
    const ok = await ui.modal({
      title: 'MacroDroid-Import',
      content: h('div', { class: 'import-report' },
        h('p', { class: 'dialog-help' }, `${res.macros.length} Makro${res.macros.length === 1 ? '' : 's'}`
          + (res.blocks.length ? `, ${res.blocks.length} Action Block${res.blocks.length === 1 ? '' : 's'}` : '')
          + (res.variables.length ? `, ${res.variables.length} globale Variable${res.variables.length === 1 ? '' : 'n'}` : '')
          + (total ? '. Nicht alles lässt sich 1:1 übertragen – Details unten.' : '. Alles konnte übernommen werden.')),
        res.report.map((x) => h('div', { class: 'import-item' },
          h('div', { class: 'import-name' }, icon(x.block ? 'widgets' : 'bolt'), h('strong', null, x.name)),
          h('div', { class: 'import-counts' }, `${x.triggers} Auslöser · ${x.actions} Aktionen · ${x.constraints} Bedingungen`),
          x.missing.length ? h('div', { class: 'import-missing' }, h('span', null, 'Nicht übernommen: '), [...new Set(x.missing)].join(', ')) : null,
          x.check.length ? h('ul', { class: 'import-check' }, x.check.map((c) => h('li', null, c))) : null))),
      buttons: [{ label: 'Abbrechen', value: false }, { label: 'Importieren', value: true, primary: true }],
    });
    if (!ok) return;
    for (const v of res.variables) if (!S().variables.some((x) => x.name === v.name)) S().variables.push(v);
    res.blocks.forEach((b) => S().blocks.push(b));
    res.macros.forEach((m) => { S().macros.push(m); MS.store.ensureCategory(m.category); });
    MS.store.changed('all');
    ui.toast(`${res.macros.length} MacroDroid-Makro${res.macros.length === 1 ? '' : 's'} importiert`, 2500, 'check_circle');
    if (res.macros.length === 1) go('#/macro/' + res.macros[0].id);
    else go('#/macros');
  }

  // ================================================================= START
  const TILES = [
    { label: 'Makro hinzufügen', icon: 'add_circle', color: '#e9573f', href: '#/macro/new' },
    { label: 'Makros', icon: 'format_list_bulleted', color: '#2f7de1', href: '#/macros', count: () => S().macros.length },
    { label: 'Vorlagen', icon: 'dashboard_customize', color: '#2ea05a', href: '#/templates', count: () => MS.templates.list.length },
    { label: 'Variablen', icon: 'data_object', color: '#8b5cf6', href: '#/variables', count: () => S().variables.length },
    { label: 'Action Blocks', icon: 'widgets', color: '#0ea5a4', href: '#/blocks', count: () => S().blocks.length },
    { label: 'Systemprotokoll', icon: 'receipt_long', color: '#64748b', href: '#/log' },
    { label: 'Einstellungen', icon: 'settings', color: '#475569', href: '#/settings' },
    { label: 'Hilfe', icon: 'help', color: '#f5a524', onClick: () => showHelp() },
  ];

  views.home = () => {
    let off;
    return {
      title: 'Makro Studio', nav: 'home',
      actions: [{ icon: 'upload_file', label: 'Importieren', onClick: importData }],
      render(root) {
        off = live(() => {
          const st = S();
          const enabled = st.macros.filter((m) => m.enabled).length;
          const running = MS.engine.running.size;
          const widgets = [];
          for (const m of st.macros) {
            if (!m.enabled) continue;
            for (const t of m.triggers) if (t.type === 'widget' && t.enabled !== false) widgets.push({ m, t });
          }
          fill(root, 
            h('div', { class: 'status-card' + (st.settings.enabled ? '' : ' off') },
              h('div', { class: 'status-main' },
                h('div', { class: 'status-icon' }, icon(st.settings.enabled ? 'bolt' : 'power_off')),
                h('div', null,
                  h('div', { class: 'status-title' }, st.settings.enabled ? 'Makro Studio ist aktiv' : 'Makro Studio ist pausiert'),
                  h('div', { class: 'status-sub' }, `${enabled} von ${st.macros.length} Makros aktiviert`)),
                switchEl(st.settings.enabled, (v) => { st.settings.enabled = v; MS.store.changed('settings'); }, 'Makro Studio aktiv')),
              running ? h('div', { class: 'status-running' },
                h('span', { class: 'pulse' }), `${running} Makro${running > 1 ? 's laufen' : ' läuft'} gerade`,
                h('button', { class: 'btn btn-small', type: 'button', onclick: () => { MS.engine.cancel(null); ui.toast('Alle Makros abgebrochen'); } }, 'Alle abbrechen')) : null,
              MS.store.persistent ? null : h('div', { class: 'status-warn' }, icon('warning'), 'Speicher nicht verfügbar – Änderungen gehen beim Schließen verloren.')),
            permissionBanner(),
            h('div', { class: 'tile-grid' }, TILES.map((t) => h('button', {
              class: 'tile', type: 'button', style: { '--tile': t.color },
              onclick: () => (t.onClick ? t.onClick() : go(t.href)),
            }, h('span', { class: 'tile-icon' }, icon(t.icon)), h('span', { class: 'tile-label' }, t.label), t.count ? h('span', { class: 'tile-count' }, String(t.count())) : null))),
            widgets.length ? h('section', { class: 'home-section' },
              h('h2', { class: 'section-title' }, 'Widget-Buttons'),
              h('div', { class: 'widget-grid' }, widgets.map(({ m, t }) => h('button', {
                class: 'widget-btn', type: 'button', title: m.name,
                onclick: () => {
                  if (!S().settings.enabled) { ui.toast('Makro Studio ist pausiert'); return; }
                  MS.bus.emit('widget', t.id);
                },
              }, h('span', { class: 'widget-circle', style: { background: t.params.color || 'var(--action)' } }, icon(t.params.icon || 'play_arrow')), h('span', null, t.params.label || m.name))))) : null,
            h('section', { class: 'home-section' },
              h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, 'Letzte Ereignisse'), h('a', { href: '#/log', class: 'link' }, 'Alle anzeigen')),
              st.log.length
                ? h('div', { class: 'card list' }, st.log.slice(0, 5).map(logRow))
                : h('p', { class: 'muted pad' }, 'Noch keine Ereignisse. Lege ein Makro an oder starte mit einer Vorlage.')));
        }, ['store', 'running', 'log', 'engine', 'app-resume']);
      },
      destroy() { off && off(); },
    };
  };

  /** Startseite (Android): zeigt, wie viele Berechtigungen noch fehlen. */
  function permissionBanner() {
    if (!MS.native.available) return null;
    const st = MS.native.permissions();
    const list = MS.PERMISSIONS.filter((p) => !p.minSdk || st.sdk >= p.minSdk);
    const missing = list.filter((p) => !st[p.key]).length;
    return h('button', { class: 'perm-banner' + (missing ? '' : ' ok'), type: 'button', onclick: () => go('#/permissions') },
      icon(missing ? 'shield' : 'verified_user'),
      h('span', { class: 'perm-banner-text' },
        h('strong', null, missing ? `${missing} Berechtigung${missing > 1 ? 'en' : ''} noch nicht eingerichtet` : 'Alle Berechtigungen eingerichtet'),
        h('span', null, st.service ? 'Hintergrunddienst läuft' : 'Hintergrunddienst ist aus – Makros laufen nur bei geöffneter App')),
      icon('chevron_right'));
  }

  function showHelp() {
    ui.modal({
      title: 'So funktioniert Makro Studio',
      content: h('div', { class: 'help' },
        h('p', null, 'Ein Makro besteht aus drei Teilen – genau wie bei MacroDroid:'),
        h('p', null, h('strong', { style: { color: 'var(--trigger)' } }, 'Auslöser'), ' starten das Makro (z. B. Uhrzeit, Akkustand, Schütteln, Widget-Button).'),
        h('p', null, h('strong', { style: { color: 'var(--action)' } }, 'Aktionen'), ' werden der Reihe nach ausgeführt (Benachrichtigung, Sprachausgabe, HTTP-Anfrage, Variablen, Wenn/Sonst, Schleifen …).'),
        h('p', null, h('strong', { style: { color: 'var(--constraint)' } }, 'Bedingungen'), ' müssen erfüllt sein, damit das Makro läuft (z. B. nur werktags, nur zwischen 9 und 18 Uhr).'),
        h('p', null, h('strong', null, 'Magic Text'), ' wie {time}, {battery} oder {v=name} fügt Werte in Texte ein – über den { }-Knopf neben Textfeldern.'),
        h('p', null, h('a', { href: '#/guide', class: 'link' }, 'Einrichtungsanleitung öffnen'), ' – erklärt Installation, Hintergrundbetrieb und alle Berechtigungen.'),
        h('p', null, h('strong', null, 'Hinweis: '), MS.native.available
          ? 'Auslöser funktionieren, solange Makro Studio läuft. Die Zurück-Taste schickt die App in den Hintergrund, statt sie zu beenden. WLAN oder Bluetooth schalten dürfen normale Apps seit Android 10 nicht mehr.'
          : 'Makro Studio läuft im Browser. Auslöser funktionieren, solange die App geöffnet ist (am besten als App installieren und Bildschirm wach halten). Systemfunktionen wie WLAN oder Bluetooth schalten kann ein Browser nicht.')),
      buttons: [{ label: 'Verstanden', primary: true, value: true }],
    });
  }

  function logRow(e) {
    const ICON = { info: 'bolt', action: 'play_arrow', user: 'edit_document', warn: 'warning', error: 'error' };
    return h('div', { class: 'log-row lvl-' + e.level },
      h('span', { class: 'log-icon' }, icon(ICON[e.level] || 'info')),
      h('div', { class: 'log-text' },
        h('div', { class: 'log-meta' }, h('span', null, fmtDateTime(new Date(e.t))), e.source ? h('span', { class: 'log-src' }, e.source) : null),
        h('div', { class: 'log-msg' }, e.msg)));
  }

  // ========================================================== MAKROLISTE
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem('makrostudio.collapsed') || '{}'); } catch (e) { collapsed = {}; }
  const saveCollapsed = () => { try { localStorage.setItem('makrostudio.collapsed', JSON.stringify(collapsed)); } catch (e) { /* egal */ } };

  views.macros = () => {
    let off, query = '';
    const searchInput = h('input', { class: 'input search', type: 'search', placeholder: 'Makros durchsuchen …', 'aria-label': 'Makros durchsuchen' });
    return {
      title: 'Makros', nav: 'macros',
      actions: [
        { icon: 'upload_file', label: 'Importieren', onClick: importData },
        { icon: 'download', label: 'Alle exportieren', onClick: () => (S().macros.length ? exportMacros(S().macros, 'makros.json') : ui.toast('Keine Makros vorhanden')) },
      ],
      render(root) {
        const listBox = h('div');
        searchInput.addEventListener('input', () => { query = searchInput.value.trim().toLowerCase(); draw(); });
        root.replaceChildren(h('div', { class: 'toolbar' }, searchInput), listBox, fab('add', 'Makro hinzufügen', () => go('#/macro/new')));
        const draw = () => {
          const st = S();
          if (!st.macros.length) {
            listBox.replaceChildren(emptyState('auto_awesome', 'Noch keine Makros', 'Erstelle dein erstes Makro oder starte mit einer Vorlage.',
              h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('#/macro/new') }, icon('add'), 'Makro hinzufügen'),
              h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => go('#/templates') }, icon('dashboard_customize'), 'Vorlagen')));
            return;
          }
          const match = (m) => !query || (m.name + ' ' + (m.description || '') + ' ' + m.category).toLowerCase().includes(query);
          const cats = [...new Set([...st.categories, ...st.macros.map((m) => m.category || 'Allgemein')])];
          const groups = cats.map((c) => [c, st.macros.filter((m) => (m.category || 'Allgemein') === c && match(m))]).filter(([, ms]) => ms.length);
          if (!groups.length) { listBox.replaceChildren(h('p', { class: 'empty' }, 'Keine Treffer.')); return; }
          listBox.replaceChildren(...groups.map(([c, ms]) => categoryGroup(c, ms)));
        };
        off = live(draw, ['store', 'running']);
      },
      destroy() { off && off(); },
    };
  };

  function categoryGroup(cat, macros) {
    const open = !collapsed[cat];
    const on = macros.filter((m) => m.enabled).length;
    const head = h('div', { class: 'cat-head', role: 'button', tabindex: '0', 'aria-expanded': String(open),
      onclick: () => { collapsed[cat] = open; saveCollapsed(); MS.bus.emit('store', 'ui'); },
    },
      icon(open ? 'expand_more' : 'chevron_right'),
      h('span', { class: 'cat-name' }, cat),
      h('span', { class: 'count' }, `${on}/${macros.length}`),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Kategorie-Optionen', onclick: async (e) => {
        e.stopPropagation();
        const r = await ui.sheet('Kategorie „' + cat + '“', [
          { icon: 'toggle_on', label: 'Alle aktivieren', value: 'on' },
          { icon: 'toggle_off', label: 'Alle deaktivieren', value: 'off' },
          { icon: 'edit', label: 'Umbenennen', value: 'rename' },
        ]);
        if (r === 'on' || r === 'off') { S().macros.forEach((m) => { if ((m.category || 'Allgemein') === cat) m.enabled = r === 'on'; }); MS.store.changed('macros'); }
        if (r === 'rename') {
          const n = (await ui.prompt('Kategorie umbenennen', '', cat) || '').trim();
          if (!n || n === cat) return;
          S().macros.forEach((m) => { if ((m.category || 'Allgemein') === cat) m.category = n; });
          S().categories = [...new Set(S().categories.map((c) => (c === cat ? n : c)))];
          MS.store.changed('macros');
        }
      } }, icon('more_vert')));
    return h('section', { class: 'cat' }, head, open ? h('div', { class: 'card list' }, macros.map(macroRow)) : null);
  }

  function macroRow(m) {
    const T = MS.catalog.triggers;
    const first = m.triggers[0] && T[m.triggers[0].type];
    const running = MS.engine.isRunning(m.id);
    const trigText = m.triggers.map((t) => (T[t.type] ? T[t.type].name : t.type)).join(', ') || 'Kein Auslöser';
    return h('div', { class: 'macro-row' + (m.enabled ? '' : ' disabled'), role: 'button', tabindex: '0', onclick: () => go('#/macro/' + m.id), onkeydown: (e) => { if (e.key === 'Enter') go('#/macro/' + m.id); } },
      h('span', { class: 'macro-icon' }, icon(first ? first.icon : 'bolt'), running ? h('span', { class: 'run-dot' }) : null),
      h('div', { class: 'macro-text' },
        h('div', { class: 'macro-name' }, m.name || 'Unbenannt'),
        h('div', { class: 'macro-sub' }, trigText),
        h('div', { class: 'macro-meta' },
          h('span', { class: 'mini t' }, icon('bolt'), String(m.triggers.length)),
          h('span', { class: 'mini a' }, icon('play_arrow'), String(m.actions.length)),
          h('span', { class: 'mini c' }, icon('rule'), String(m.constraints.length)),
          h('span', { class: 'mini-time' }, 'Zuletzt: ' + relTime(m.lastRun)))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Makro-Optionen', onclick: (e) => { e.stopPropagation(); macroMenu(m); } }, icon('more_vert')),
      switchEl(m.enabled, (v) => { m.enabled = v; MS.store.changed('macros'); }, 'Makro aktiv'));
  }

  async function macroMenu(m) {
    const r = await ui.sheet(m.name || 'Unbenannt', [
      { icon: 'play_arrow', label: 'Jetzt ausführen (ohne Bedingungen)', value: 'run' },
      { icon: 'stop_circle', label: 'Laufende Ausführung abbrechen', value: 'cancel', hidden: !MS.engine.isRunning(m.id) },
      { icon: 'edit', label: 'Bearbeiten', value: 'edit' },
      { icon: 'content_copy', label: 'Duplizieren', value: 'dup' },
      { icon: 'download', label: 'Exportieren', value: 'export' },
      { icon: 'delete', label: 'Löschen', value: 'del', danger: true },
    ]);
    if (r === 'run') MS.engine.runMacro(m, { trigger: 'Manuell', ignoreConstraints: true });
    if (r === 'cancel') MS.engine.cancel(m.id);
    if (r === 'edit') go('#/macro/' + m.id);
    if (r === 'dup') duplicateMacro(m);
    if (r === 'export') exportMacros([m], fileSafe(m.name) + '.json');
    if (r === 'del') deleteMacro(m);
  }
  function duplicateMacro(m) {
    const c = clone(m);
    c.id = uid();
    c.name = (m.name || 'Unbenannt') + ' (Kopie)';
    c.lastRun = null;
    [...c.triggers, ...c.actions, ...c.constraints].forEach((x) => { x.id = uid(); });
    S().macros.splice(S().macros.indexOf(m) + 1, 0, c);
    MS.store.changed('macros');
    ui.toast('Makro dupliziert');
    return c;
  }
  async function deleteMacro(m) {
    if (!(await ui.confirm('Makro löschen?', `„${m.name || 'Unbenannt'}“ wird endgültig gelöscht.`, 'Löschen', 'Abbrechen', true))) return false;
    MS.engine.cancel(m.id);
    S().macros = S().macros.filter((x) => x !== m && x.id !== m.id);
    MS.store.changed('macros');
    ui.toast('Makro gelöscht');
    return true;
  }

  // ============================================================== EDITOR
  /** Editor für Makros (kind 'macro') und Action Blocks (kind 'block'). */
  views.editor = (id, kind) => {
    const isBlock = kind === 'block';
    const coll = () => (isBlock ? S().blocks : S().macros);
    const stored = id === 'new' ? null : coll().find((x) => x.id === id);
    if (id !== 'new' && !stored) return views.notFound(isBlock ? 'Action Block nicht gefunden' : 'Makro nicht gefunden');
    const blank = () => (isBlock
      ? { id: uid(), name: '', description: '', actions: [], localVars: [] }
      : { id: uid(), name: '', description: '', category: S().categories[0] || 'Allgemein', enabled: true, triggers: [], actions: [], constraints: [], constraintLogic: 'and', localVars: [], created: Date.now() });
    let draft = stored ? clone(stored) : blank();
    let savedJson = stored ? JSON.stringify(draft) : '';
    let isNew = !stored;
    const dirty = () => JSON.stringify(draft) !== savedJson;
    const formCtx = () => ({ locals: draft.localVars, ownerId: draft.id, triggers: draft.triggers || [] });
    let root, keyHandler;

    function save() {
      if (!draft.name.trim()) {
        ui.toast('Bitte gib einen Namen ein');
        const n = root.querySelector('.name-input');
        if (n) n.focus();
        return false;
      }
      draft.name = draft.name.trim();
      const list = coll();
      const i = list.findIndex((x) => x.id === draft.id);
      const copy = clone(draft);
      if (!isBlock) {
        const live = MS.store.macro(draft.id);
        if (live && live.lastRun) copy.lastRun = live.lastRun;
        MS.store.ensureCategory(copy.category);
      }
      if (i >= 0) list[i] = copy; else list.push(copy);
      savedJson = JSON.stringify(draft);
      MS.store.changed(isBlock ? 'blocks' : 'macros');
      if (isNew) {
        isNew = false;
        history.replaceState(null, '', (isBlock ? '#/block/' : '#/macro/') + draft.id);
        MS.app.setLastHash(location.hash);
      }
      ui.toast(isBlock ? 'Action Block gespeichert' : 'Makro gespeichert', 1600, 'check_circle');
      return true;
    }

    async function testRun() {
      if (!draft.actions.length) { ui.toast('Keine Aktionen vorhanden'); return; }
      ui.toast('Aktionen werden ausgeführt …', 1400, 'play_arrow');
      // Mit Kopie der lokalen Variablen testen, damit der Entwurf unverändert bleibt
      const locals = clone(draft.localVars);
      if (isBlock) await MS.engine.runActions(draft.actions, MS.engine.context(draft, { trigger: 'Test', locals }));
      else await MS.engine.runMacro(draft, { trigger: 'Test', ignoreConstraints: true, locals });
    }

    // ---- Abschnitte
    function itemRow(kindName, item, index, depth, list) {
      const d = MS.catalog.get(kindName, item.type);
      const isFlow = kindName === 'action' && d && d.flow;
      const disabled = item.enabled === false;
      const color = { trigger: 'var(--trigger)', action: 'var(--action)', constraint: 'var(--constraint)' }[kindName];
      return h('div', {
        class: 'item' + (disabled ? ' disabled' : '') + (isFlow ? ' flow flow-' + item.type : ''),
        style: { '--depth': depth || 0 }, role: 'button', tabindex: '0',
        onclick: () => itemMenu(kindName, item, index, list),
        onkeydown: (e) => { if (e.key === 'Enter') itemMenu(kindName, item, index, list); },
      },
        h('span', { class: 'item-icon', style: { background: isFlow ? 'var(--flow)' : color } }, icon(d ? d.icon : 'help')),
        h('div', { class: 'item-text' },
          h('div', { class: 'item-title' }, item.invert ? h('span', { class: 'badge' }, 'NICHT') : null, d ? d.name : 'Unbekannt: ' + item.type, d && !MS.catalog.supported(d) ? h('span', { class: 'badge warn', title: 'Hier nicht verfügbar' }, '!') : null,
            ui.missingPermissions(d).length ? h('span', { class: 'badge perm', title: 'Berechtigung fehlt' }, 'Berechtigung fehlt') : null),
          (() => { const s = MS.catalog.describe(kindName, item); return s ? h('div', { class: 'item-sub' }, s) : null; })()),
        icon('more_vert', 'item-more'));
    }

    async function itemMenu(kindName, item, index, list) {
      const d = MS.catalog.get(kindName, item.type);
      const isFlow = kindName === 'action' && d && d.flow;
      const r = await ui.sheet(d ? d.name : item.type, [
        { icon: 'tune', label: 'Konfigurieren', value: 'edit', hidden: !d || !d.params.length },
        { icon: 'play_arrow', label: 'Aktion testen', value: 'test', hidden: kindName !== 'action' || isFlow },
        { icon: 'bolt', label: 'Makro auslösen (Test)', value: 'fire', hidden: kindName !== 'trigger' },
        { icon: 'fact_check', label: 'Jetzt prüfen', value: 'check', hidden: kindName !== 'constraint' },
        { icon: 'add_box', label: 'Aktion darunter einfügen', value: 'insert', hidden: kindName !== 'action' },
        { icon: 'arrow_upward', label: 'Nach oben', value: 'up', hidden: index === 0 },
        { icon: 'arrow_downward', label: 'Nach unten', value: 'down', hidden: index === list.length - 1 },
        { icon: 'block', label: item.invert ? 'Umkehrung aufheben' : 'Umkehren (NICHT)', value: 'invert', hidden: kindName !== 'constraint' },
        { icon: item.enabled === false ? 'toggle_on' : 'toggle_off', label: item.enabled === false ? 'Aktivieren' : 'Deaktivieren', value: 'toggle', hidden: isFlow },
        { icon: 'content_copy', label: 'Duplizieren', value: 'dup', hidden: isFlow },
        { icon: 'delete', label: 'Löschen', value: 'del', danger: true },
      ], MS.catalog.describe(kindName, item));
      switch (r) {
        case 'edit': {
          const np = await ui.configure(kindName, item, formCtx());
          if (np) item.params = np;
          break;
        }
        case 'test': MS.engine.testAction(item, Object.assign({}, draft, { localVars: clone(draft.localVars) })); break;
        case 'fire': testRun(); break;
        case 'check': {
          const ok = MS.engine.check(item, MS.engine.context(draft));
          ui.toast(ok ? 'Bedingung ist erfüllt' : 'Bedingung ist nicht erfüllt', 2000, ok ? 'check_circle' : 'cancel');
          break;
        }
        case 'insert': await addItem('action', index + 1); return;
        case 'up': [list[index - 1], list[index]] = [list[index], list[index - 1]]; break;
        case 'down': [list[index + 1], list[index]] = [list[index], list[index + 1]]; break;
        case 'invert': item.invert = !item.invert; break;
        case 'toggle': item.enabled = item.enabled === false; break;
        case 'dup': list.splice(index + 1, 0, Object.assign(clone(item), { id: uid() })); break;
        case 'del': deleteItem(kindName, item, index, list); break;
        default: return;
      }
      draw();
    }

    function deleteItem(kindName, item, index, list) {
      if (kindName !== 'action' || !['if', 'loop', 'end_if', 'end_loop'].includes(item.type)) { list.splice(index, 1); return; }
      // Bei Blockanfang/-ende den ganzen Rahmen entfernen, Inhalt bleibt erhalten
      const flow = MS.engine.buildFlow(list);
      const remove = new Set([index]);
      if (item.type === 'if' || item.type === 'end_if') {
        let start = index;
        if (item.type === 'end_if') start = list.findIndex((_, i) => flow[i].end === index && list[i].type === 'if');
        if (start >= 0) {
          remove.add(start);
          for (let j = flow[start].next; j !== undefined && j < list.length; j = flow[j].next) remove.add(j);
        }
      } else {
        const partner = item.type === 'loop' ? flow[index].end : flow[index].start;
        if (partner !== undefined && partner < list.length) remove.add(partner);
      }
      [...remove].sort((a, b) => b - a).forEach((i) => list.splice(i, 1));
    }

    async function addItem(kindName, at) {
      const type = await ui.pick(kindName);
      if (!type) return;
      const item = MS.catalog.create(kindName, type);
      const np = await ui.configure(kindName, item, formCtx());
      if (!np) return;
      item.params = np;
      const list = kindName === 'trigger' ? draft.triggers : kindName === 'action' ? draft.actions : draft.constraints;
      const pos = at === undefined ? list.length : at;
      const extra = type === 'if' ? 'end_if' : type === 'loop' ? 'end_loop' : null;
      list.splice(pos, 0, item);
      if (extra) list.splice(pos + 1, 0, MS.catalog.create('action', extra));
      draw();
      requestAnimationFrame(() => {
        const el = root.querySelector(`[data-sec="${kindName}"] .item:nth-child(${pos + 1})`);
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }

    function section(kindName, title, ic, items, extraHead) {
      const color = { trigger: 'var(--trigger)', action: 'var(--action)', constraint: 'var(--constraint)' }[kindName];
      let body;
      if (kindName === 'action') {
        const { depth, warnings } = MS.engine.analyze(items);
        body = [
          warnings.length ? h('div', { class: 'warn-box' }, icon('warning'), h('div', null, warnings.map((w) => h('div', null, w)))) : null,
          h('div', { class: 'items' }, items.map((it, i) => itemRow(kindName, it, i, depth[i], items))),
        ];
      } else {
        body = h('div', { class: 'items' }, items.map((it, i) => itemRow(kindName, it, i, 0, items)));
      }
      const emptyText = { trigger: 'Tippe auf +, um einen Auslöser hinzuzufügen.', action: 'Tippe auf +, um eine Aktion hinzuzufügen.', constraint: 'Optional: Bedingungen schränken ein, wann das Makro läuft.' }[kindName];
      return h('section', { class: 'sec', 'data-sec': kindName, style: { '--sec': color } },
        h('header', { class: 'sec-head' },
          icon(ic), h('h2', null, title), h('span', { class: 'count' }, String(items.length)), extraHead || null,
          h('button', { class: 'sec-add', type: 'button', 'aria-label': title + ' hinzufügen', onclick: () => addItem(kindName) }, icon('add'))),
        items.length ? body : h('p', { class: 'sec-empty' }, emptyText));
    }

    function varsSection() {
      const vars = draft.localVars;
      const IO = { input: 'Eingabe', output: 'Ausgabe', both: 'Ein-/Ausgabe' };
      return h('section', { class: 'sec', style: { '--sec': 'var(--localvar)' } },
        h('header', { class: 'sec-head' }, icon('data_object'), h('h2', null, isBlock ? 'Variablen (Ein-/Ausgabe)' : 'Lokale Variablen'), h('span', { class: 'count' }, String(vars.length)),
          h('button', { class: 'sec-add', type: 'button', 'aria-label': 'Variable hinzufügen', onclick: async () => {
            const res = await ui.varDialog({ scopes: ['l'], takenNames: () => vars.map((v) => v.name) });
            if (res) { if (isBlock) res.variable.io = 'input'; vars.push(res.variable); draw(); }
          } }, icon('add'))),
        vars.length
          ? h('div', { class: 'items' }, vars.map((v, i) => h('div', { class: 'item', role: 'button', tabindex: '0', onclick: async () => {
            const r = await ui.sheet(v.name, [
              { icon: 'edit', label: 'Bearbeiten', value: 'edit' },
              { icon: 'login', label: 'Als Eingabe', value: 'input', hidden: !isBlock },
              { icon: 'logout', label: 'Als Ausgabe', value: 'output', hidden: !isBlock },
              { icon: 'sync_alt', label: 'Ein- und Ausgabe', value: 'both', hidden: !isBlock },
              { icon: 'lock', label: 'Nur intern', value: 'none', hidden: !isBlock },
              { icon: 'delete', label: 'Löschen', value: 'del', danger: true },
            ]);
            if (r === 'edit') {
              const res = await ui.varDialog({ variable: v, scopes: ['l'], takenNames: () => vars.map((x) => x.name) });
              if (res) vars[i] = Object.assign({}, v, res.variable);
            } else if (r === 'del') vars.splice(i, 1);
            else if (r) v.io = r;
            draw();
          } },
            h('span', { class: 'item-icon', style: { background: 'var(--localvar)' } }, icon(varIcon(v.type))),
            h('div', { class: 'item-text' },
              h('div', { class: 'item-title' }, v.name, isBlock && v.io && v.io !== 'none' ? h('span', { class: 'badge io' }, IO[v.io]) : null),
              h('div', { class: 'item-sub' }, `${MS.vars.TYPES[v.type]} · ${MS.vars.format(v.value) || '(leer)'}`)),
            icon('more_vert', 'item-more'))))
          : h('p', { class: 'sec-empty' }, isBlock ? 'Variablen als Eingabe/Ausgabe markieren, um Werte zu übergeben.' : 'Lokale Variablen gelten nur in diesem Makro ({lv=name}).'));
    }

    function header() {
      const name = h('input', { class: 'name-input', value: draft.name, placeholder: isBlock ? 'Name des Action Blocks' : 'Makroname', 'aria-label': 'Name' });
      name.addEventListener('input', () => { draft.name = name.value; });
      const desc = h('textarea', { class: 'input desc-input', rows: 2, value: draft.description || '', placeholder: 'Beschreibung (optional)', 'aria-label': 'Beschreibung' });
      desc.addEventListener('input', () => { draft.description = desc.value; });
      let catRow = null;
      if (!isBlock) {
        const cats = [...new Set([...S().categories, draft.category])];
        const sel = h('select', { class: 'input' }, cats.map((c) => h('option', { value: c }, c)), h('option', { value: '__new' }, '+ Neue Kategorie …'));
        sel.value = draft.category;
        sel.addEventListener('change', async () => {
          if (sel.value === '__new') {
            const n = ((await ui.prompt('Neue Kategorie', '', '')) || '').trim();
            if (n) { MS.store.ensureCategory(n); MS.store.save(); draft.category = n; }
            draw();
            return;
          }
          draft.category = sel.value;
        });
        catRow = h('div', { class: 'head-row' },
          h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, 'Kategorie'), sel),
          h('label', { class: 'switch-row compact' }, h('span', null, 'Aktiviert'), switchEl(draft.enabled, (v) => { draft.enabled = v; })));
      }
      return h('div', { class: 'editor-head' }, name, catRow, desc);
    }

    function draw() {
      const scroll = window.scrollY;
      const logicToggle = !isBlock && draft.constraints.length > 1
        ? h('button', { class: 'logic-toggle', type: 'button', title: 'Verknüpfung umschalten', onclick: () => { draft.constraintLogic = draft.constraintLogic === 'or' ? 'and' : 'or'; draw(); } },
          draft.constraintLogic === 'or' ? 'ODER' : 'UND')
        : null;
      fill(root, 
        header(),
        isBlock ? null : section('trigger', 'Auslöser', 'bolt', draft.triggers),
        section('action', 'Aktionen', 'play_arrow', draft.actions),
        isBlock ? null : section('constraint', 'Bedingungen', 'rule', draft.constraints, logicToggle),
        varsSection(),
        h('div', { class: 'fab-space' }),
        fab('check', 'Speichern', save, 'fab-save'));
      window.scrollTo(0, scroll);
    }

    const menu = async () => {
      const r = await ui.sheet(draft.name || 'Unbenannt', [
        { icon: 'play_arrow', label: 'Aktionen testen', value: 'test' },
        { icon: 'fact_check', label: 'Bedingungen prüfen', value: 'check', hidden: isBlock },
        { icon: 'content_copy', label: 'Duplizieren', value: 'dup', hidden: isNew || isBlock },
        { icon: 'download', label: 'Exportieren', value: 'export', hidden: isBlock },
        { icon: 'delete', label: 'Löschen', value: 'del', danger: true },
      ]);
      if (r === 'test') testRun();
      if (r === 'check') {
        const ok = MS.engine.checkAll(draft.constraints, draft.constraintLogic, MS.engine.context(draft));
        ui.toast(ok ? 'Alle Bedingungen erfüllt' : 'Bedingungen nicht erfüllt', 2000, ok ? 'check_circle' : 'cancel');
      }
      if (r === 'dup') {
        if (dirty() && !save()) return;
        const c = duplicateMacro(MS.store.macro(draft.id));
        savedJson = JSON.stringify(draft);
        go('#/macro/' + c.id);
      }
      if (r === 'export') exportMacros([clone(draft)], fileSafe(draft.name) + '.json');
      if (r === 'del') {
        if (isNew) { savedJson = JSON.stringify(draft); go(isBlock ? '#/blocks' : '#/macros'); return; }
        if (isBlock) {
          if (!(await ui.confirm('Action Block löschen?', `„${draft.name}“ wird gelöscht. Makros, die ihn verwenden, melden dann einen Fehler.`, 'Löschen', 'Abbrechen', true))) return;
          S().blocks = S().blocks.filter((b) => b.id !== draft.id);
          MS.store.changed('blocks');
        } else if (!(await deleteMacro(MS.store.macro(draft.id) || draft))) return;
        savedJson = JSON.stringify(draft);
        go(isBlock ? '#/blocks' : '#/macros');
      }
    };

    return {
      title: isBlock ? (isNew ? 'Neuer Action Block' : 'Action Block') : isNew ? 'Neues Makro' : 'Makro bearbeiten',
      back: isBlock ? '#/blocks' : '#/macros',
      hideNav: true,
      actions: [
        { icon: 'play_arrow', label: 'Aktionen testen', onClick: testRun },
        { icon: 'more_vert', label: 'Mehr', onClick: menu },
      ],
      render(r) {
        root = r;
        root.classList.add('editor');
        draw();
        keyHandler = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
        document.addEventListener('keydown', keyHandler);
      },
      destroy() { document.removeEventListener('keydown', keyHandler); },
      async canLeave() {
        if (!dirty()) return true;
        const r = await ui.modal({
          title: 'Änderungen speichern?',
          content: h('p', { class: 'dialog-text' }, 'Du hast ungespeicherte Änderungen.'),
          buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Verwerfen', value: 'discard', danger: true }, { label: 'Speichern', value: 'save', primary: true }],
        });
        if (r === 'discard') return true;
        if (r === 'save') return save();
        return false;
      },
    };
  };
  const varIcon = (t) => ({ boolean: 'toggle_on', integer: 'tag', decimal: 'percent', string: 'text_fields' })[t] || 'data_object';

  // ============================================================= VORLAGEN
  views.templates = () => ({
    title: 'Vorlagen', nav: 'templates',
    render(root) {
      root.replaceChildren(
        h('p', { class: 'intro' }, 'Fertige Makros zum Ausprobieren und Anpassen. Tippe auf eine Vorlage für Details.'),
        h('div', { class: 'tpl-grid' }, MS.templates.list.map((t) => h('button', { class: 'tpl-card', type: 'button', onclick: () => previewTemplate(t) },
          h('span', { class: 'tpl-icon', style: { background: t.color } }, icon(t.icon)),
          h('span', { class: 'tpl-text' }, h('span', { class: 'tpl-name' }, t.name), h('span', { class: 'tpl-desc' }, t.description)),
          h('span', { class: 'tpl-cat' }, t.category)))));
    },
  });

  async function previewTemplate(t) {
    const m = MS.templates.instantiate(Object.assign({}, t, { variables: [] })); // nur Vorschau
    const block = (title, color, kindName, items) => items.length ? h('div', { class: 'tpl-sec', style: { '--sec': color } },
      h('div', { class: 'tpl-sec-title' }, title),
      items.map((it) => {
        const d = MS.catalog.get(kindName, it.type);
        return h('div', { class: 'tpl-line' }, icon(d.icon), h('span', null, h('strong', null, d.name), ' ', MS.catalog.describe(kindName, it)));
      })) : null;
    const ok = await ui.modal({
      title: t.name,
      content: h('div', null,
        h('p', { class: 'dialog-help' }, t.description),
        block('Auslöser', 'var(--trigger)', 'trigger', m.triggers),
        block('Aktionen', 'var(--action)', 'action', m.actions),
        block('Bedingungen', 'var(--constraint)', 'constraint', m.constraints)),
      buttons: [{ label: 'Schließen', value: false }, { label: 'Vorlage verwenden', value: true, primary: true }],
    });
    if (!ok) return;
    const macro = MS.templates.instantiate(t);
    S().macros.push(macro);
    MS.store.changed('macros');
    ui.toast('Makro aus Vorlage erstellt', 1800, 'check_circle');
    go('#/macro/' + macro.id);
  }

  // ============================================================ VARIABLEN
  views.variables = () => {
    let off;
    const taken = () => S().variables.map((v) => v.name);
    return {
      title: 'Globale Variablen', nav: 'variables',
      render(root) {
        const listBox = h('div');
        root.replaceChildren(
          h('p', { class: 'intro' }, 'Globale Variablen gelten in allen Makros. In Texten mit {v=name} einfügen.'),
          listBox,
          fab('add', 'Variable hinzufügen', async () => {
            const res = await ui.varDialog({ scopes: ['g'], takenNames: taken });
            if (res) { S().variables.push(res.variable); MS.store.changed('vars'); }
          }));
        off = live(() => {
          const vars = S().variables;
          if (!vars.length) {
            listBox.replaceChildren(emptyState('data_object', 'Keine Variablen', 'Variablen speichern Werte wie Zähler, Texte oder Ja/Nein-Zustände.'));
            return;
          }
          listBox.replaceChildren(h('div', { class: 'card list' }, vars.map((v) => h('div', { class: 'var-row', role: 'button', tabindex: '0', onclick: () => varMenu(v) },
            h('span', { class: 'item-icon', style: { background: 'var(--localvar)' } }, icon(varIcon(v.type))),
            h('div', { class: 'item-text' }, h('div', { class: 'item-title' }, v.name), h('div', { class: 'item-sub' }, MS.vars.TYPES[v.type])),
            h('span', { class: 'var-value' + (v.type === 'boolean' ? (v.value ? ' true' : ' false') : '') }, MS.vars.format(v.value) || '—')))));
        }, ['vars', 'store']);
      },
      destroy() { off && off(); },
    };
    async function varMenu(v) {
      const r = await ui.sheet(v.name, [
        { icon: 'edit_note', label: 'Wert ändern', value: 'value', hidden: v.type === 'boolean' },
        { icon: 'toggle_on', label: 'Umschalten', value: 'toggle', hidden: v.type !== 'boolean' },
        { icon: 'edit', label: 'Bearbeiten', value: 'edit' },
        { icon: 'delete', label: 'Löschen', value: 'del', danger: true },
      ], `${MS.vars.TYPES[v.type]} · ${MS.vars.format(v.value)}`);
      const ref = 'g:' + v.name;
      if (r === 'toggle') MS.vars.set(ref, !v.value);
      if (r === 'value') {
        const nv = await ui.prompt(v.name, 'Neuer Wert', MS.vars.format(v.value), v.type === 'string' ? 'text' : 'number');
        if (nv !== null) MS.vars.set(ref, nv);
      }
      if (r === 'edit') {
        const res = await ui.varDialog({ variable: v, scopes: ['g'], takenNames: taken });
        if (res) { Object.assign(v, res.variable); MS.store.changed('vars'); }
      }
      if (r === 'del') {
        const used = JSON.stringify([S().macros, S().blocks]).match(new RegExp(`"g:${v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
        if (await ui.confirm('Variable löschen?', used ? `„${v.name}“ wird noch in Makros verwendet.` : `„${v.name}“ wird gelöscht.`, 'Löschen', 'Abbrechen', true)) {
          S().variables = S().variables.filter((x) => x !== v);
          MS.store.changed('vars');
        }
      }
    }
  };

  // ======================================================== ACTION BLOCKS
  views.blocks = () => {
    let off;
    return {
      title: 'Action Blocks', back: '#/',
      render(root) {
        const listBox = h('div');
        root.replaceChildren(
          h('p', { class: 'intro' }, 'Action Blocks sind wiederverwendbare Aktionsfolgen mit Ein- und Ausgabevariablen – aufrufbar über die Aktion „Action Block“.'),
          listBox,
          fab('add', 'Action Block hinzufügen', () => go('#/block/new')));
        off = live(() => {
          const blocks = S().blocks;
          if (!blocks.length) {
            listBox.replaceChildren(emptyState('widgets', 'Keine Action Blocks', 'Fasse wiederkehrende Aktionen zu einem Block zusammen.'));
            return;
          }
          listBox.replaceChildren(h('div', { class: 'card list' }, blocks.map((b) => h('div', { class: 'var-row', role: 'button', tabindex: '0', onclick: () => go('#/block/' + b.id) },
            h('span', { class: 'item-icon', style: { background: '#0ea5a4' } }, icon('widgets')),
            h('div', { class: 'item-text' }, h('div', { class: 'item-title' }, b.name || 'Unbenannt'), h('div', { class: 'item-sub' }, b.description || `${b.actions.length} Aktionen`)),
            icon('chevron_right', 'item-more')))));
        }, ['store']);
      },
      destroy() { off && off(); },
    };
  };

  // ============================================================ PROTOKOLL
  views.log = () => {
    let off, filter = 'all', query = '';
    const FILTERS = [['all', 'Alle'], ['info', 'Makros'], ['action', 'Aktionen'], ['user', 'Benutzer'], ['warn', 'Warnungen'], ['error', 'Fehler']];
    return {
      title: 'Systemprotokoll', nav: 'log',
      actions: [{ icon: 'delete_sweep', label: 'Protokoll leeren', onClick: async () => {
        if (await ui.confirm('Protokoll leeren?', 'Alle Einträge werden gelöscht.', 'Leeren', 'Abbrechen', true)) {
          S().log = [];
          MS.store.save();
          MS.bus.emit('log');
        }
      } }],
      render(root) {
        const chips = h('div', { class: 'chips filter' });
        const search = h('input', { class: 'input search', type: 'search', placeholder: 'Protokoll durchsuchen …', 'aria-label': 'Protokoll durchsuchen' });
        const listBox = h('div');
        search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); draw(); });
        root.replaceChildren(h('div', { class: 'toolbar' }, search), chips, listBox);
        const draw = () => {
          chips.replaceChildren(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (filter === k ? ' on' : ''), type: 'button', onclick: () => { filter = k; draw(); } }, l)));
          const items = S().log.filter((e) => (filter === 'all' || e.level === filter) && (!query || (e.msg + ' ' + e.source).toLowerCase().includes(query)));
          listBox.replaceChildren(items.length ? h('div', { class: 'card list' }, items.slice(0, 300).map(logRow)) : h('p', { class: 'empty' }, 'Keine Einträge.'));
        };
        off = live(draw, ['log']);
      },
      destroy() { off && off(); },
    };
  };

  // ========================================================= EINSTELLUNGEN
  views.settings = () => {
    let off;
    return {
      title: 'Einstellungen', back: '#/',
      render(root) {
        off = live(() => {
          const st = S().settings;
          const setS = (k, v, what = 'settings') => { st[k] = v; MS.store.changed(what); };
          const row = (title, sub, control) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, title), sub ? h('div', { class: 'set-sub' }, sub) : null), control);
          const sel = (value, options, onchange) => {
            const s = h('select', { class: 'input input-small' }, options.map(([v, l]) => h('option', { value: v }, l)));
            s.value = value;
            s.addEventListener('change', () => onchange(s.value));
            return s;
          };
          const perm = (name) => (typeof Notification !== 'undefined' && name === 'notifications' ? Notification.permission : '');
          const notifState = MS.native.available
            ? (MS.native.notificationsAllowed() ? 'erlaubt' : 'nicht erlaubt')
            : 'Notification' in window ? { granted: 'erlaubt', denied: 'blockiert', default: 'nicht gefragt' }[perm('notifications')] : 'nicht unterstützt';
          const lat = h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', value: st.lat, placeholder: 'z. B. 47.9990' });
          const lon = h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', value: st.lon, placeholder: 'z. B. 7.8421' });
          lat.addEventListener('change', () => { st.lat = lat.value; MS.store.save(); });
          lon.addEventListener('change', () => { st.lon = lon.value; MS.store.save(); });
          const home = MS.geo.home();
          let sunText = 'Kein Standort hinterlegt.';
          if (home) {
            const t = MS.geo.sunTimes(new Date(), home.lat, home.lon);
            sunText = isNaN(t.sunrise) ? 'Heute kein Sonnenauf-/untergang (Polartag/-nacht).' : `Heute: Sonnenaufgang ${fmtTime(t.sunrise)}, Sonnenuntergang ${fmtTime(t.sunset)}`;
          }
          fill(root, 
            h('h2', { class: 'set-group' }, 'Allgemein'),
            h('div', { class: 'card' },
              row('Makro Studio aktiv', 'Schaltet alle Auslöser ein oder aus.', switchEl(st.enabled, (v) => setS('enabled', v))),
              row('Design', null, sel(st.theme, [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], (v) => { setS('theme', v); MS.app.applyTheme(); })),
              row('Bildschirm wach halten', 'Hält das Display an, damit Auslöser zuverlässig laufen.', switchEl(st.keepAwake, (v) => {
                setS('keepAwake', v);
                MS.catalog.setWake(v).catch((e) => ui.toast(e.message));
              })),
              row('Aktionen protokollieren', 'Jede ausgeführte Aktion im Systemprotokoll vermerken.', switchEl(st.logActions, (v) => setS('logActions', v))),
              row('Protokollgröße', null, sel(String(st.logLimit), [['100', '100 Einträge'], ['500', '500 Einträge'], ['2000', '2000 Einträge']], (v) => setS('logLimit', Number(v))))),

            MS.native.available ? backgroundCard(row) : null,
            h('h2', { class: 'set-group' }, 'Berechtigungen'),
            MS.native.available ? h('div', { class: 'card' },
              row('Alle Berechtigungen', 'Status und Einrichtung von Benachrichtigungen, Standort, Bedienungshilfe usw.', h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => go('#/permissions') }, 'Öffnen')),
              row('Einrichtungsanleitung', 'Schritt für Schritt: wo man welche Berechtigung einstellt.', h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => go('#/guide') }, 'Anzeigen'))) : null,
            MS.native.available ? null : h('div', { class: 'card' },
              row('Benachrichtigungen', 'Status: ' + notifState, h('button', { class: 'btn btn-tonal', type: 'button', onclick: async () => {
                let ok;
                if (MS.native.available) ok = await MS.native.requestPermission('notifications');
                else if ('Notification' in window) ok = (await Notification.requestPermission()) === 'granted';
                else return ui.toast('Nicht unterstützt');
                ui.toast(ok ? 'Benachrichtigungen erlaubt' : 'Benachrichtigungen nicht erlaubt');
                MS.bus.emit('store', 'ui');
              } }, 'Erlauben')),
              row('Bewegungssensoren', 'Für „Gerät schütteln“ und „Gerät umdrehen“ (iOS fragt nach).', h('button', { class: 'btn btn-tonal', type: 'button', onclick: async () => {
                try { ui.toast((await MS.device.requestMotionPermission()) ? 'Sensoren freigegeben' : 'Sensoren nicht verfügbar'); } catch (e) { ui.toast(e.message); }
              } }, 'Freigeben')),
              row('Standort', MS.device.position ? `Letzte Position: ${MS.device.position.lat.toFixed(4)}, ${MS.device.position.lon.toFixed(4)}` : 'Für Geofences und Sonnenzeiten.', h('button', { class: 'btn btn-tonal', type: 'button', onclick: async () => {
                try { await MS.device.getPosition(); ui.toast('Standort ermittelt'); MS.bus.emit('store', 'ui'); } catch (e) { ui.toast(e.message); }
              } }, 'Abrufen')),
              row('Einrichtungsanleitung', 'Für die Android-App: wo man welche Berechtigung einstellt.', h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => go('#/guide') }, 'Anzeigen'))),

            h('h2', { class: 'set-group' }, 'Standort für Sonnenzeiten'),
            h('div', { class: 'card pad' },
              h('div', { class: 'grid-2' }, ui.field('Breitengrad', lat), ui.field('Längengrad', lon)),
              h('button', { class: 'btn btn-tonal', type: 'button', onclick: async () => {
                try {
                  const p = await MS.device.getPosition();
                  st.lat = p.lat.toFixed(4); st.lon = p.lon.toFixed(4);
                  MS.store.changed('settings');
                } catch (e) { ui.toast(e.message); }
              } }, icon('my_location'), 'Aktuellen Standort übernehmen'),
              h('p', { class: 'field-hint' }, sunText)),

            h('h2', { class: 'set-group' }, 'Daten'),
            h('div', { class: 'card' },
              row('Alles exportieren', 'Makros, Variablen und Action Blocks als JSON-Datei.', h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => {
                const s = S();
                download('makrostudio-backup.json', { app: 'makrostudio', version: 1, macros: s.macros, variables: s.variables, blocks: s.blocks, categories: s.categories });
              } }, 'Exportieren')),
              row('Importieren', 'Makros aus einer JSON-Datei hinzufügen.', h('button', { class: 'btn btn-tonal', type: 'button', onclick: importData }, 'Importieren')),
              row('Alles zurücksetzen', 'Löscht alle Makros, Variablen, Blocks und das Protokoll.', h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
                if (!(await ui.confirm('Alles löschen?', 'Alle Daten werden unwiderruflich gelöscht.', 'Alles löschen', 'Abbrechen', true))) return;
                MS.engine.cancel(null);
                MS.store.state = MS.store.defaults();
                MS.store.changed('all');
                MS.app.applyTheme();
                ui.toast('Alle Daten gelöscht');
              } }, 'Löschen'))),

            h('h2', { class: 'set-group' }, 'Über'),
            h('div', { class: 'card pad about' },
              h('p', null, h('strong', null, 'Makro Studio'), MS.native.available ? ' – ein Makro-Ersteller im Stil von MacroDroid. Alle Daten bleiben auf diesem Gerät.' : ' – ein Makro-Ersteller im Stil von MacroDroid, der komplett im Browser läuft. Alle Daten bleiben auf diesem Gerät.'),
              h('p', { class: 'muted' }, MS.native.available
                ? 'Auslöser funktionieren, solange die App läuft. Mit der Zurück-Taste läuft sie im Hintergrund weiter; Android kann sie dort aber nach einiger Zeit beenden.'
                : 'Auslöser funktionieren, solange die App geöffnet ist. Für den Dauerbetrieb die App installieren und „Bildschirm wach halten“ aktivieren.'),
              MS.native.available ? null : MS.app.installPrompt ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => MS.app.install() }, icon('install_mobile'), 'Als App installieren') : null));
        }, ['store', 'engine', 'app-resume']);
      },
      destroy() { off && off(); },
    };
  };

  // ================================================== HINTERGRUND & RECHTE
  /** Karte „Hintergrundbetrieb“ (Android): Dienst, Autostart, CPU wach halten. */
  function backgroundCard(row) {
    const st = MS.native.permissions();
    const toggle = (key) => (v) => {
      MS.native.setBackground(key, v);
      setTimeout(() => MS.bus.emit('app-resume'), 600);
    };
    return [
      h('h2', { class: 'set-group' }, 'Hintergrundbetrieb'),
      h('div', { class: 'card' },
        row('Hintergrunddienst', st.service ? 'Läuft – Makros arbeiten auch bei geschlossener App.' : 'Aus – Makros laufen nur, solange die App geöffnet ist.', switchEl(st.service, toggle('service'), 'Hintergrunddienst')),
        row('Beim Gerätestart starten', 'Startet den Dienst nach einem Neustart automatisch (Auslöser „Gerät gestartet“).', switchEl(st.autostart, toggle('autostart'), 'Beim Gerätestart starten')),
        row('CPU wach halten', 'Makros laufen auch bei ausgeschaltetem Bildschirm pünktlich. Braucht etwas mehr Akku.', switchEl(st.cpu_wake, toggle('cpu_wake'), 'CPU wach halten'))),
    ];
  }

  views.permissions = () => {
    let off;
    return {
      title: 'Berechtigungen', back: '#/settings',
      actions: [{ icon: 'menu_book', label: 'Einrichtungsanleitung', onClick: () => go('#/guide') }],
      render(root) {
        if (!MS.native.available) {
          root.replaceChildren(emptyState('android', 'Nur in der Android-App', 'Berechtigungen wie Bedienungshilfe oder Benachrichtigungszugriff gibt es nur in der Android-App (APK).',
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('#/guide') }, icon('menu_book'), 'Einrichtungsanleitung')));
          return;
        }
        const openState = {};
        off = live(() => {
          const st = MS.native.permissions();
          const list = MS.PERMISSIONS.filter((p) => !p.minSdk || st.sdk >= p.minSdk);
          const done = list.filter((p) => st[p.key]).length;
          const row = (title, sub, control) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, title), sub ? h('div', { class: 'set-sub' }, sub) : null), control);
          const vendor = MS.SETUP_GUIDE.vendors.find(([name]) => name.toLowerCase().includes(String(st.manufacturer || '').toLowerCase()));
          fill(root, 
            h('div', { class: 'perm-summary' },
              h('div', { class: 'perm-progress' }, h('span', { style: { width: Math.round((done / list.length) * 100) + '%' } })),
              h('span', null, `${done} von ${list.length} Berechtigungen eingerichtet`)),
            ...backgroundCard(row),
            h('h2', { class: 'set-group' }, 'Berechtigungen'),
            h('div', { class: 'perm-list' }, list.map((perm) => {
              const ok = !!st[perm.key];
              const det = h('details', { class: 'perm-steps', open: !!openState[perm.key] },
                h('summary', null, 'So geht’s'),
                h('ol', null, perm.steps.map((s) => h('li', null, s))),
                perm.restricted && st.sdk >= 33 ? h('div', { class: 'perm-restricted' },
                  h('p', null, h('strong', null, 'Schalter ausgegraut? '), MS.SETUP_GUIDE.restricted[2]),
                  h('button', { class: 'btn btn-small-tonal', type: 'button', onclick: () => MS.native.requestPermission('app_info') }, icon('info'), 'App-Info öffnen')) : null);
              det.addEventListener('toggle', () => { openState[perm.key] = det.open; });
              return h('div', { class: 'perm-card' + (ok ? ' ok' : '') },
                h('div', { class: 'perm-head' },
                  h('span', { class: 'perm-icon' }, icon(perm.icon)),
                  h('div', { class: 'perm-title' }, h('strong', null, perm.title), h('span', { class: 'perm-status' }, icon(ok ? 'check_circle' : 'error'), ok ? 'Erteilt' : 'Fehlt')),
                  h('button', { class: 'btn ' + (ok ? 'btn-text' : 'btn-primary'), type: 'button', onclick: async () => {
                    await MS.native.requestPermission(perm.key);
                    setTimeout(() => MS.bus.emit('app-resume'), 300);
                  } }, ok ? 'Ändern' : 'Einrichten')),
                h('p', { class: 'perm-why' }, perm.why),
                h('p', { class: 'perm-uses' }, 'Benötigt für: ', perm.uses.join(', ')),
                det);
            })),
            vendor ? h('div', { class: 'card pad vendor-tip' }, h('strong', null, `Tipp für ${vendor[0]}`), h('p', null, vendor[1])) : null,
            h('div', { class: 'card pad' },
              h('p', null, 'Bei manchen Herstellern beendet das System Apps trotz Berechtigungen. Die Anleitung enthält Tipps für Samsung, Xiaomi, Huawei und OnePlus.'),
              h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => go('#/guide') }, icon('menu_book'), 'Einrichtungsanleitung')));
        }, ['app-resume']);
      },
      destroy() { off && off(); },
    };
  };

  /** Einrichtungsanleitung – auch als PDF (tools/build-guide.mjs). */
  views.guide = () => ({
    title: 'Einrichtungsanleitung', back: MS.native.available ? '#/permissions' : '#/settings',
    render(root) {
      const G = MS.SETUP_GUIDE;
      const C = MS.catalog;
      const kinds = [['trigger', 'Auslöser'], ['action', 'Aktion'], ['constraint', 'Bedingung']];
      const rows = [];
      for (const [kind, label] of kinds) {
        for (const d of Object.values(C.map(kind))) {
          if (!d.needs) continue;
          const perms = d.needs.map((n) => n.split('|').map((k) => (MS.PERMISSIONS.find((p) => p.key === k) || { title: k }).title).join(' oder '));
          rows.push(h('tr', null, h('td', null, d.name), h('td', null, label), h('td', null, perms.join(' + '))));
        }
      }
      root.classList.add('guide');
      root.replaceChildren(
        h('header', { class: 'guide-head' },
          h('h1', null, 'Makro Studio – Einrichtungsanleitung'),
          h('p', null, 'Installation, Hintergrundbetrieb und alle Berechtigungen der Android-App. Stand: ' + MS.util.fmtDate(new Date()))),
        h('section', null, h('h2', null, '1. App installieren'), h('ol', null, G.install.map((s) => h('li', null, s)))),
        h('section', null, h('h2', null, '2. Hintergrundbetrieb einschalten'),
          h('p', null, 'Damit Makros auch bei geschlossener App laufen. Alles unter Makro Studio → Einstellungen → „Hintergrundbetrieb“.'),
          h('ol', null, G.background.map((s) => h('li', null, s)))),
        h('section', null, h('h2', null, '3. Berechtigungen'),
          h('p', null, 'Alle Berechtigungen findest du in Makro Studio unter Einstellungen → „Alle Berechtigungen“. Der Knopf „Einrichten“ öffnet jeweils die richtige Android-Seite. Erteile nur, was du für deine Makros brauchst.'),
          MS.PERMISSIONS.map((perm, i) => h('article', { class: 'guide-perm' },
            h('h3', null, `3.${i + 1} ${perm.title}`, perm.minSdk ? h('span', { class: 'guide-note' }, ` (ab Android ${perm.minSdk === 29 ? '10' : perm.minSdk})`) : null),
            h('p', null, perm.why),
            h('p', { class: 'guide-uses' }, h('strong', null, 'Benötigt für: '), perm.uses.join(', ')),
            h('ol', null, perm.steps.map((s) => h('li', null, s)))))),
        h('section', null, h('h2', null, '4. Eingeschränkte Einstellungen freigeben (Android 13 und neuer)'),
          h('p', null, 'Betrifft die Bedienungshilfe und den Benachrichtigungszugriff.'),
          h('ol', null, G.restricted.map((s) => h('li', null, s)))),
        h('section', null, h('h2', null, '5. Tipps für einzelne Hersteller'),
          h('table', { class: 'guide-table' }, h('thead', null, h('tr', null, h('th', null, 'Hersteller'), h('th', null, 'Einstellung'))),
            h('tbody', null, G.vendors.map(([v, t]) => h('tr', null, h('td', null, v), h('td', null, t)))))),
        h('section', null, h('h2', null, '6. Welche Funktion braucht welche Berechtigung?'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'guide-table' },
            h('thead', null, h('tr', null, h('th', null, 'Funktion'), h('th', null, 'Art'), h('th', null, 'Berechtigung'))),
            h('tbody', null, rows)))),
        h('section', null, h('h2', null, '7. Was technisch nicht geht'), h('ul', null, G.limits.map((s) => h('li', null, s)))));
    },
  });

  views.notFound = (msg = 'Seite nicht gefunden') => ({
    title: 'Nicht gefunden', back: '#/',
    render(root) {
      root.replaceChildren(emptyState('search_off', msg, 'Der Eintrag existiert nicht (mehr).', h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('#/') }, 'Zur Startseite')));
    },
  });
})();
