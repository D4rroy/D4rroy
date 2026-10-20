/* Makro Studio – UI-Bausteine: DOM-Helfer, Toasts, Dialoge, Menüs,
 * Katalog-Auswahl und der Konfigurationsdialog mit Formularfeldern. */
'use strict';
(function () {
  const MS = window.MS;

  /** h('div', {class: 'x', onclick: fn}, kinder…) */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : String(kid));
    }
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [prop, val] of Object.entries(v)) {
            if (prop.startsWith('--')) el.style.setProperty(prop, val);
            else el.style[prop] = val;
          }
        }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    return el;
  }
  const icon = (name, cls) => h('span', { class: 'mi' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, name);

  const ui = (MS.ui = { h, icon });

  // ---------------------------------------------------------------- Toasts
  ui.toast = function (msg, ms = 2200, ic) {
    const box = document.getElementById('toasts');
    const t = h('div', { class: 'toast' }, ic ? icon(ic) : null, h('span', null, msg));
    box.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, ms);
  };

  // ---------------------------------------------------------------- Dialoge
  const stack = [];
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      const top = stack[stack.length - 1];
      if (top.dismissible) top.close(null);
    }
  });

  /**
   * Öffnet einen Dialog. content: Element oder (close) => Element.
   * buttons: [{label, value, primary, danger, validate}] → Promise mit value.
   */
  ui.modal = function ({ title, content, buttons = [], variant = 'dialog', dismissible = true, onOpen }) {
    return new Promise((resolve) => {
      let done = false;
      const entry = { dismissible };
      const close = (val) => {
        if (done) return;
        done = true;
        overlay.classList.remove('open');
        stack.splice(stack.indexOf(entry), 1);
        setTimeout(() => overlay.remove(), 180);
        resolve(val === undefined ? null : val);
      };
      entry.close = close;
      const body = typeof content === 'function' ? content(close) : content;
      const footer = buttons.length
        ? h('div', { class: 'dialog-actions' }, buttons.map((b) =>
          h('button', {
            class: 'btn ' + (b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-text'),
            type: 'button',
            onclick: () => {
              if (b.validate && !b.validate()) return;
              close(typeof b.value === 'function' ? b.value() : b.value);
            },
          }, b.label)))
        : null;
      const dialog = h('div', { class: 'dialog dialog-' + variant, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
        title ? h('div', { class: 'dialog-head' },
          variant === 'full' ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: () => close(null) }, icon('arrow_back')) : null,
          h('h2', null, title)) : null,
        h('div', { class: 'dialog-body' }, body),
        footer);
      const overlay = h('div', { class: 'overlay overlay-' + variant }, dialog);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && dismissible) close(null); });
      document.body.append(overlay);
      stack.push(entry);
      requestAnimationFrame(() => {
        overlay.classList.add('open');
        const first = dialog.querySelector('[autofocus], input:not([type=checkbox]), textarea');
        if (first && variant !== 'sheet') first.focus({ preventScroll: true });
      });
      if (onOpen) onOpen(close, dialog);
    });
  };

  ui.alert = (title, text, ok = 'OK') =>
    ui.modal({ title, content: h('p', { class: 'dialog-text' }, text || ''), buttons: [{ label: ok, value: true, primary: true }] });

  ui.confirm = async (title, text, yes = 'OK', no = 'Abbrechen', danger = false) =>
    (await ui.modal({
      title,
      content: h('p', { class: 'dialog-text' }, text || ''),
      buttons: [{ label: no, value: false }, { label: yes, value: true, primary: !danger, danger }],
    })) === true;

  ui.prompt = (title, message, def = '', type = 'text') => {
    const input = h('input', { class: 'input', type: type === 'number' ? 'number' : 'text', value: def ?? '', inputmode: type === 'number' ? 'decimal' : null, step: 'any' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('.dialog').querySelector('.btn-primary').click(); });
    return ui.modal({
      title,
      content: h('div', null, message ? h('p', { class: 'dialog-text' }, message) : null, input),
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'OK', primary: true, value: () => input.value }],
    });
  };

  /** Liste von Optionen → Index oder null */
  ui.choose = (title, options) =>
    ui.modal({
      title,
      content: (close) => h('div', { class: 'choice-list' }, options.map((o, i) =>
        h('button', { class: 'choice', type: 'button', onclick: () => close(i) }, o))),
      buttons: [{ label: 'Abbrechen', value: null }],
    });

  /** Menü als Bottom-Sheet: items [{icon, label, value, danger, hidden}] */
  ui.sheet = (title, items, subtitle) =>
    ui.modal({
      variant: 'sheet',
      content: (close) => h('div', null,
        title ? h('div', { class: 'sheet-head' }, h('strong', null, title), subtitle ? h('span', null, subtitle) : null) : null,
        h('div', { class: 'sheet-list' }, items.filter((i) => i && !i.hidden).map((it) =>
          h('button', { class: 'sheet-item' + (it.danger ? ' danger' : ''), type: 'button', onclick: () => close(it.value) },
            icon(it.icon || 'chevron_right'), h('span', null, it.label))))),
    });

  // ------------------------------------------------------ Katalog-Auswahl
  const KIND_INFO = {
    trigger: { title: 'Auslöser hinzufügen', color: 'var(--trigger)' },
    action: { title: 'Aktion hinzufügen', color: 'var(--action)' },
    constraint: { title: 'Bedingung hinzufügen', color: 'var(--constraint)' },
  };
  ui.KIND_INFO = KIND_INFO;

  /** Vollbild-Auswahl mit Kategorien und Suche → Typ oder null. */
  ui.pick = function (kind) {
    const map = MS.catalog.map(kind);
    const cats = MS.catalog.categories[kind];
    const color = KIND_INFO[kind].color;
    return ui.modal({
      title: KIND_INFO[kind].title,
      variant: 'full',
      content: (close) => {
        const list = h('div', { class: 'picker-list' });
        const search = h('input', { class: 'input search', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Suchen' });
        const tile = (d) => {
          const ok = MS.catalog.supported(d);
          return h('button', { class: 'pick-tile' + (ok ? '' : ' unsupported'), type: 'button', onclick: () => close(d.type), title: d.help || d.name },
            h('span', { class: 'pick-icon', style: { background: color } }, icon(d.icon)),
            h('span', { class: 'pick-name' }, d.name),
            ok ? null : h('span', { class: 'pick-note' }, 'hier nicht verfügbar'));
        };
        const render = () => {
          const q = search.value.trim().toLowerCase();
          list.replaceChildren();
          if (q) {
            const hits = Object.values(map).filter((d) => (d.name + ' ' + (d.help || '')).toLowerCase().includes(q));
            list.append(hits.length ? h('div', { class: 'pick-grid' }, hits.map(tile)) : h('p', { class: 'empty' }, 'Nichts gefunden.'));
            return;
          }
          for (const c of cats) {
            const items = Object.values(map).filter((d) => d.cat === c.id);
            if (!items.length) continue;
            const grid = h('div', { class: 'pick-grid' }, items.map(tile));
            const det = h('details', { class: 'pick-cat' },
              h('summary', null,
                h('span', { class: 'pick-cat-icon', style: { color } }, icon(c.icon)),
                h('span', { class: 'pick-cat-name' }, c.name),
                h('span', { class: 'count' }, String(items.length)),
                icon('expand_more', 'chev')),
              grid);
            list.append(det);
          }
        };
        search.addEventListener('input', render);
        render();
        return h('div', { class: 'picker' }, search, list);
      },
    });
  };

  // ------------------------------------------------------ Magic-Text-Auswahl
  ui.magicPicker = function (ctx) {
    const groups = [['Allgemein', MS.magic.TOKENS]];
    const g = MS.store.state.variables.map((v) => [`{v=${v.name}}`, `Variable ${v.name}`]);
    const l = ((ctx && ctx.locals) || []).map((v) => [`{lv=${v.name}}`, `Lokal ${v.name}`]);
    if (g.length) groups.push(['Globale Variablen', g]);
    if (l.length) groups.push(['Lokale Variablen', l]);
    return ui.modal({
      title: 'Magic Text einfügen',
      content: (close) => h('div', { class: 'magic-list' }, groups.map(([name, tokens]) => [
        h('div', { class: 'magic-group' }, name),
        tokens.map(([tok, label]) => h('button', { class: 'magic-item', type: 'button', onclick: () => close(tok) }, h('code', null, tok), h('span', null, label))),
      ])),
      buttons: [{ label: 'Abbrechen', value: null }],
    });
  };

  // --------------------------------------------------------- Variablen
  /** Dialog zum Anlegen/Bearbeiten einer Variable. */
  ui.varDialog = async function ({ variable, scopes = ['g', 'l'], types, takenNames = () => [] } = {}) {
    const v = Object.assign({ name: '', type: (types && types[0]) || 'string', value: '' }, MS.util.clone(variable) || {});
    let scope = scopes[0];
    const err = h('div', { class: 'field-error' });
    const name = h('input', { class: 'input', value: v.name, placeholder: 'z. B. zaehler', autocapitalize: 'off', spellcheck: 'false' });
    const typeSel = h('select', { class: 'input' }, Object.entries(MS.vars.TYPES).filter(([k]) => !types || types.includes(k)).map(([k, l]) => h('option', { value: k }, l)));
    typeSel.value = v.type;
    const valueBox = h('div');
    const renderValue = () => {
      const t = typeSel.value;
      const cur = MS.vars.coerce(t, v.value);
      let input;
      if (t === 'boolean') {
        input = h('select', { class: 'input' }, h('option', { value: 'true' }, 'Wahr (true)'), h('option', { value: 'false' }, 'Falsch (false)'));
        input.value = String(cur);
      } else {
        input = h('input', { class: 'input', type: t === 'string' ? 'text' : 'number', step: t === 'integer' ? '1' : 'any', value: String(cur) });
      }
      input.addEventListener('input', () => { v.value = input.value; });
      input.addEventListener('change', () => { v.value = input.value; });
      valueBox.replaceChildren(field('Wert', input));
    };
    typeSel.addEventListener('change', () => { v.type = typeSel.value; renderValue(); });
    renderValue();
    const scopeSel = scopes.length > 1
      ? h('select', { class: 'input', onchange: (e) => { scope = e.target.value; } },
        h('option', { value: 'g' }, 'Global (für alle Makros)'), h('option', { value: 'l' }, 'Lokal (nur dieses Makro)'))
      : null;
    const ok = await ui.modal({
      title: variable ? 'Variable bearbeiten' : 'Neue Variable',
      content: h('div', { class: 'form' },
        field('Name', name), field('Typ', typeSel), valueBox, scopeSel ? field('Gültigkeit', scopeSel) : null, err),
      buttons: [
        { label: 'Abbrechen', value: false },
        {
          label: 'Speichern', primary: true, value: true,
          validate: () => {
            const n = name.value.trim();
            if (!MS.vars.validName(n)) { err.textContent = 'Bitte einen gültigen Namen ohne { } = : eingeben.'; return false; }
            if (takenNames(scope).includes(n) && (!variable || variable.name !== n)) { err.textContent = 'Dieser Name ist bereits vergeben.'; return false; }
            return true;
          },
        },
      ],
    });
    if (!ok) return null;
    return { scope, variable: { name: name.value.trim(), type: typeSel.value, value: MS.vars.coerce(typeSel.value, v.value) } };
  };

  // ------------------------------------------------------- Formularfelder
  function field(label, control, hint) {
    return h('label', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  }
  ui.field = field;

  const COLORS = ['#e04848', '#ff6d3a', '#f5a524', '#2ea05a', '#0ea5a4', '#2f7de1', '#6366f1', '#8b5cf6', '#db2777', '#475569', '#ffffff', '#111827'];
  const ICONS = ['play_arrow', 'bolt', 'star', 'favorite', 'home', 'work', 'alarm', 'lightbulb', 'flashlight_on', 'volume_up', 'music_note', 'notifications', 'wifi', 'call', 'mail', 'map', 'directions_car', 'coffee', 'bedtime', 'casino', 'add', 'check', 'timer', 'local_drink'];

  /**
   * Rendert ein Formular für die Parameter eines Katalogeintrags. Wählfelder
   * lösen ein Neuzeichnen aus, damit abhängige Felder (showIf) erscheinen.
   * ctx: { locals, item, ownerId, kind }
   */
  ui.renderForm = function (container, fields, p, ctx) {
    const render = () => {
      container.replaceChildren(...fields.filter((f) => !f.showIf || f.showIf(p)).map((f) => control(f)).filter(Boolean));
    };
    const takenNames = (scope) => (scope === 'l' ? (ctx.locals || []) : MS.store.state.variables).map((v) => v.name);

    function control(f) {
      const set = (v) => { p[f.key] = v; };
      switch (f.type) {
        case 'info':
          return h('p', { class: 'field-info' }, typeof f.text === 'function' ? f.text(p, ctx) : f.text);
        case 'text':
        case 'textarea': {
          const input = f.type === 'text'
            ? h('input', { class: 'input', type: 'text', value: p[f.key] ?? '' })
            : h('textarea', { class: 'input', rows: 3, value: p[f.key] ?? '' });
          input.addEventListener('input', () => set(input.value));
          const row = h('div', { class: 'input-row' }, input, f.magic ? h('button', {
            class: 'icon-btn magic-btn', type: 'button', title: 'Magic Text einfügen', 'aria-label': 'Magic Text einfügen',
            onclick: async () => {
              const tok = await ui.magicPicker(ctx);
              if (!tok) return;
              const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? input.value.length;
              input.value = input.value.slice(0, s) + tok + input.value.slice(e);
              set(input.value);
              input.focus();
              input.setSelectionRange(s + tok.length, s + tok.length);
            },
          }, h('span', { class: 'magic-glyph' }, '{ }')) : null);
          return field(f.label, row);
        }
        case 'number': {
          const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: f.step || 'any', min: f.min, max: f.max, value: p[f.key] ?? '' });
          input.addEventListener('input', () => set(input.value === '' ? '' : Number(input.value)));
          return field(f.label, input);
        }
        case 'time': {
          const input = h('input', { class: 'input', type: 'time', value: p[f.key] || '00:00' });
          input.addEventListener('input', () => set(input.value));
          return field(f.label, input);
        }
        case 'select': {
          const sel = h('select', { class: 'input' }, f.options.map(([v, l]) => h('option', { value: v }, l)));
          sel.value = p[f.key];
          sel.addEventListener('change', () => { set(sel.value); render(); });
          return field(f.label, sel);
        }
        case 'bool': {
          const cb = h('input', { type: 'checkbox', checked: !!p[f.key] });
          cb.addEventListener('change', () => { set(cb.checked); render(); });
          return h('label', { class: 'switch-row' }, h('span', null, f.label), h('span', { class: 'switch' }, cb, h('span', { class: 'slider' })));
        }
        case 'chips': {
          const vals = new Set(p[f.key] || []);
          const wrap = h('div', { class: 'chips' + (f.options.length > 12 ? ' chips-dense' : '') }, f.options.map(([v, l]) => {
            const b = h('button', { class: 'chip' + (vals.has(v) ? ' on' : ''), type: 'button', 'aria-pressed': String(vals.has(v)) }, l);
            b.addEventListener('click', () => {
              vals.has(v) ? vals.delete(v) : vals.add(v);
              b.classList.toggle('on', vals.has(v));
              b.setAttribute('aria-pressed', String(vals.has(v)));
              set([...vals]);
            });
            return b;
          }));
          return h('div', { class: 'field' }, h('span', { class: 'field-label' }, f.label), wrap);
        }
        case 'color': {
          const wrap = h('div', { class: 'swatches' }, COLORS.map((c) => h('button', {
            class: 'swatch' + (p[f.key] === c ? ' on' : ''), type: 'button', style: { background: c }, 'aria-label': c,
            onclick: () => { set(c); render(); },
          })));
          return h('div', { class: 'field' }, h('span', { class: 'field-label' }, f.label), wrap);
        }
        case 'icon': {
          const wrap = h('div', { class: 'icon-grid' }, ICONS.map((n) => h('button', {
            class: 'icon-choice' + (p[f.key] === n ? ' on' : ''), type: 'button', 'aria-label': n,
            onclick: () => { set(n); render(); },
          }, icon(n))));
          return h('div', { class: 'field' }, h('span', { class: 'field-label' }, f.label), wrap);
        }
        case 'var': {
          const allowLocal = f.scope !== 'global' && ctx.locals;
          const ok = (v) => !f.varTypes || f.varTypes.includes(v.type);
          const typeLabel = (v) => ' (' + MS.vars.TYPES[v.type] + ')';
          const sel = h('select', { class: 'input' },
            h('option', { value: '' }, f.optional ? '— keine —' : '— Variable wählen —'),
            h('optgroup', { label: 'Global' }, MS.store.state.variables.filter(ok).map((v) => h('option', { value: 'g:' + v.name }, v.name + typeLabel(v)))),
            allowLocal ? h('optgroup', { label: 'Lokal' }, ctx.locals.filter(ok).map((v) => h('option', { value: 'l:' + v.name }, v.name + typeLabel(v)))) : null,
            h('option', { value: '__new' }, '+ Neue Variable …'));
          sel.value = p[f.key] || '';
          sel.addEventListener('change', async () => {
            if (sel.value !== '__new') { set(sel.value); return; }
            const res = await ui.varDialog({ scopes: allowLocal ? ['g', 'l'] : ['g'], types: f.varTypes, takenNames });
            if (res) {
              if (res.scope === 'l') ctx.locals.push(res.variable);
              else { MS.store.state.variables.push(res.variable); MS.store.changed('vars'); }
              set(res.scope + ':' + res.variable.name);
            }
            render();
          });
          return field(f.label, sel);
        }
        case 'macro': {
          const sel = h('select', { class: 'input' },
            h('option', { value: '' }, '— Makro wählen —'),
            f.allowThis ? h('option', { value: '__this' }, '(Dieses Makro)') : null,
            MS.store.state.macros.filter((m) => m.id !== ctx.ownerId).map((m) => h('option', { value: m.id }, m.name || 'Unbenannt')));
          sel.value = p[f.key] || '';
          sel.addEventListener('change', () => set(sel.value));
          return field(f.label, sel);
        }
        case 'block': {
          const sel = h('select', { class: 'input' },
            h('option', { value: '' }, '— Action Block wählen —'),
            MS.store.state.blocks.filter((b) => b.id !== ctx.ownerId).map((b) => h('option', { value: b.id }, b.name || 'Unbenannt')));
          sel.value = p[f.key] || '';
          sel.addEventListener('change', () => { set(sel.value); render(); });
          return field(f.label, sel);
        }
        case 'blockio': {
          const b = MS.store.block(p.block);
          if (!b) return null;
          const io = (p[f.key] = p[f.key] || { inputs: {}, outputs: {} });
          io.inputs = io.inputs || {};
          io.outputs = io.outputs || {};
          const ins = (b.localVars || []).filter((v) => v.io === 'input' || v.io === 'both');
          const outs = (b.localVars || []).filter((v) => v.io === 'output' || v.io === 'both');
          if (!ins.length && !outs.length) return h('p', { class: 'field-info' }, 'Dieser Block hat keine Ein- oder Ausgabevariablen.');
          const rows = [];
          for (const v of ins) {
            const input = h('input', { class: 'input', value: io.inputs[v.name] ?? '', placeholder: 'Standard: ' + v.value });
            input.addEventListener('input', () => { io.inputs[v.name] = input.value; });
            rows.push(field(`Eingabe „${v.name}“ (${MS.vars.TYPES[v.type]})`, input));
          }
          for (const v of outs) {
            const sel = h('select', { class: 'input' }, h('option', { value: '' }, '— nicht speichern —'),
              h('optgroup', { label: 'Global' }, MS.store.state.variables.map((x) => h('option', { value: 'g:' + x.name }, x.name))),
              ctx.locals ? h('optgroup', { label: 'Lokal' }, ctx.locals.map((x) => h('option', { value: 'l:' + x.name }, x.name))) : null);
            sel.value = io.outputs[v.name] || '';
            sel.addEventListener('change', () => { io.outputs[v.name] = sel.value; });
            rows.push(field(`Ausgabe „${v.name}“ speichern in`, sel));
          }
          return h('div', { class: 'subform' }, h('div', { class: 'subform-title' }, f.label), rows);
        }
        case 'location': {
          const pl = (p[f.key] = Object.assign({ name: '', lat: '', lon: '', radius: 150 }, p[f.key] || {}));
          const mk = (k, label, type = 'text') => {
            const i = h('input', { class: 'input', type, inputmode: type === 'number' ? 'decimal' : null, step: 'any', value: pl[k] ?? '' });
            i.addEventListener('input', () => { pl[k] = i.value; });
            return field(label, i);
          };
          const status = h('span', { class: 'field-hint' });
          const btn = h('button', {
            class: 'btn btn-tonal', type: 'button',
            onclick: async () => {
              status.textContent = 'Standort wird ermittelt …';
              try {
                const pos = await MS.device.getPosition();
                pl.lat = pos.lat.toFixed(6);
                pl.lon = pos.lon.toFixed(6);
                render();
              } catch (e) { status.textContent = e.message; }
            },
          }, icon('my_location'), 'Aktuellen Standort verwenden');
          return h('div', { class: 'subform' }, h('div', { class: 'subform-title' }, f.label),
            mk('name', 'Name (optional)'),
            h('div', { class: 'grid-2' }, mk('lat', 'Breitengrad', 'number'), mk('lon', 'Längengrad', 'number')),
            mk('radius', 'Radius in Metern', 'number'), btn, status);
        }
        case 'conditions': {
          const list = (p[f.key] = p[f.key] || []);
          const wrap = h('div', { class: 'cond-list' });
          const draw = () => {
            wrap.replaceChildren(...list.map((c, i) => {
              const d = MS.catalog.constraints[c.type];
              return h('div', { class: 'cond-item' + (c.enabled === false ? ' disabled' : '') },
                h('span', { class: 'item-icon', style: { background: 'var(--constraint)' } }, icon(d ? d.icon : 'help')),
                h('div', { class: 'item-text' },
                  h('div', { class: 'item-title' }, c.invert ? h('span', { class: 'badge' }, 'NICHT') : null, d ? d.name : c.type),
                  h('div', { class: 'item-sub' }, MS.catalog.describe('constraint', c))),
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Optionen', onclick: async () => {
                  const r = await ui.sheet(d ? d.name : c.type, [
                    { icon: 'tune', label: 'Konfigurieren', value: 'edit', hidden: !d || !d.params.length },
                    { icon: 'block', label: c.invert ? 'Umkehrung aufheben' : 'Umkehren (NICHT)', value: 'invert' },
                    { icon: 'delete', label: 'Entfernen', value: 'del', danger: true },
                  ]);
                  if (r === 'edit') { const np = await ui.configure('constraint', c, ctx); if (np) c.params = np; }
                  if (r === 'invert') c.invert = !c.invert;
                  if (r === 'del') list.splice(i, 1);
                  draw();
                } }, icon('more_vert')));
            }));
            if (!list.length) wrap.append(h('p', { class: 'field-hint' }, 'Keine Bedingungen – gilt immer als erfüllt.'));
          };
          draw();
          const add = h('button', { class: 'btn btn-tonal', type: 'button', onclick: async () => {
            const type = await ui.pick('constraint');
            if (!type) return;
            const c = MS.catalog.create('constraint', type);
            const np = await ui.configure('constraint', c, ctx);
            if (!np) return;
            c.params = np;
            list.push(c);
            draw();
          } }, icon('add'), 'Bedingung hinzufügen');
          return h('div', { class: 'subform' }, h('div', { class: 'subform-title' }, f.label), wrap, add);
        }
        default:
          return null;
      }
    }

    render();
    return {
      validate() {
        for (const f of fields) {
          if (!f.required || (f.showIf && !f.showIf(p))) continue;
          const v = p[f.key];
          if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return `Bitte „${f.label}“ ausfüllen.`;
        }
        return null;
      },
    };
  };

  /** Konfigurationsdialog für Auslöser/Aktion/Bedingung → neue Parameter oder null. */
  ui.configure = async function (kind, item, ctx = {}) {
    const d = MS.catalog.get(kind, item.type);
    const p = MS.util.clone(item.params || {});
    if (!d || !d.params.length) return p;
    const box = h('div', { class: 'form' });
    const err = h('div', { class: 'field-error' });
    const form = ui.renderForm(box, d.params, p, Object.assign({}, ctx, { item, kind }));
    const supported = MS.catalog.supported(d);
    const res = await ui.modal({
      title: d.name,
      content: h('div', null,
        d.help ? h('p', { class: 'dialog-help' }, d.help) : null,
        supported ? null : h('p', { class: 'warn-box' }, icon('warning'), 'Dieser Browser unterstützt diese Funktion nicht. Sie funktioniert ggf. auf einem anderen Gerät.'),
        box, err),
      buttons: [
        { label: 'Abbrechen', value: null },
        { label: 'OK', primary: true, value: () => p, validate: () => { const m = form.validate(); err.textContent = m || ''; return !m; } },
      ],
    });
    return res;
  };
})();
