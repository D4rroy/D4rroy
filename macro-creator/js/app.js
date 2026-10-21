/* Makro Studio – App-Start, Router, App-Leiste, Design und PWA. */
'use strict';
(function () {
  const MS = window.MS;
  const { h, icon } = MS.ui;

  const ROUTES = [
    [/^#?\/?$/, () => MS.views.home()],
    [/^#\/macros$/, () => MS.views.macros()],
    [/^#\/macro\/([\w-]+)$/, (id) => MS.views.editor(id, 'macro')],
    [/^#\/templates$/, () => MS.views.templates()],
    [/^#\/variables$/, () => MS.views.variables()],
    [/^#\/blocks$/, () => MS.views.blocks()],
    [/^#\/block\/([\w-]+)$/, (id) => MS.views.editor(id, 'block')],
    [/^#\/log$/, () => MS.views.log()],
    [/^#\/settings$/, () => MS.views.settings()],
  ];

  let current = null, lastHash = location.hash, ignoreNext = false;

  function resolve(hash) {
    for (const [re, make] of ROUTES) {
      const m = re.exec(hash);
      if (m) return make(...m.slice(1));
    }
    return MS.views.notFound();
  }

  function render() {
    if (current && current.destroy) current.destroy();
    current = resolve(location.hash);
    setChrome(current);
    const fresh = h('main', { id: 'view', class: 'view' });
    document.getElementById('view').replaceWith(fresh);
    window.scrollTo(0, 0);
    current.render(fresh);
  }

  function setChrome(v) {
    document.getElementById('appbar-title').textContent = v.title || 'Makro Studio';
    document.title = v.title && v.title !== 'Makro Studio' ? `${v.title} · Makro Studio` : 'Makro Studio';
    const back = document.getElementById('appbar-back');
    back.hidden = !v.back;
    back.onclick = () => navigate(v.back);
    document.getElementById('appbar-actions').replaceChildren(...(v.actions || []).map((a) =>
      h('button', { class: 'icon-btn', type: 'button', title: a.label, 'aria-label': a.label, onclick: a.onClick }, icon(a.icon))));
    const nav = document.getElementById('bottom-nav');
    nav.hidden = !!v.hideNav;
    document.body.classList.toggle('has-nav', !v.hideNav);
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === v.nav));
  }

  async function onHashChange() {
    if (ignoreNext) { ignoreNext = false; return; }
    // Sonderroute: Verknüpfungs-Auslöser
    const run = /^#\/run\/([\w-]+)$/.exec(location.hash);
    if (run) {
      MS.bus.emit('shortcut', run[1]);
      history.replaceState(null, '', lastHash || '#/');
      return;
    }
    if (current && current.canLeave && !(await current.canLeave())) {
      ignoreNext = true;
      location.hash = lastHash;
      return;
    }
    lastHash = location.hash;
    render();
  }

  function navigate(hash) {
    if (location.hash === hash || (!location.hash && hash === '#/')) { onHashChange(); return; }
    location.hash = hash;
  }

  function applyTheme() {
    const t = MS.store.state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const dark = t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#121a24' : '#22324a');
  }

  MS.app = {
    navigate,
    applyTheme,
    setLastHash(h) { lastHash = h; },
    /** Android-Zurück-Taste: true, wenn die App sie verarbeitet hat. */
    handleBack() {
      if (MS.ui.closeTop()) return true;
      if (current && current.back) { navigate(current.back); return true; }
      if (location.hash && location.hash !== '#/') { navigate('#/'); return true; }
      return false;
    },
    installPrompt: null,
    async install() {
      if (!this.installPrompt) return;
      this.installPrompt.prompt();
      await this.installPrompt.userChoice.catch(() => {});
      this.installPrompt = null;
      MS.bus.emit('store', 'ui');
    },
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    MS.app.installPrompt = e;
    MS.bus.emit('store', 'ui');
  });

  // ------------------------------------------------------------- Start
  MS.store.load();
  applyTheme();
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('hashchange', onHashChange);
  // Beim Öffnen über eine Verknüpfungs-Adresse den Auslöser nach dem Engine-Start feuern
  const startRun = /^#\/run\/([\w-]+)$/.exec(location.hash);
  if (startRun) history.replaceState(null, '', '#/');
  MS.device.init().finally(() => {
    MS.engine.start();
    MS.bus.emit('app-start');
    if (startRun) MS.bus.emit('shortcut', startRun[1]);
  });
  if (MS.store.state.settings.keepAwake) MS.catalog.setWake(true).catch(() => {});
  lastHash = location.hash;
  render();

  const secure = location.protocol === 'https:' || location.hostname === 'localhost';
  if ('serviceWorker' in navigator && secure && !MS.native.available) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
