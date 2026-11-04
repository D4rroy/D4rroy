/* Makro Studio – Brücke zur Android-App (APK). Im Browser ist MS.native.available false
 * und alle Funktionen nutzen weiterhin die Web-APIs. */
'use strict';
(function () {
  const MS = window.MS;
  const A = window.MakroAndroid;
  if (!A) {
    MS.native = { available: false };
    return;
  }
  const pending = {};
  let next = 0;
  let appList = null;
  /** Ruft eine Android-Methode auf, die ihr Ergebnis später über _resolve meldet. */
  const call = (fn, ...args) => new Promise((resolve) => {
    const id = 'c' + ++next;
    pending[id] = resolve;
    A[fn](...args, id);
  });
  const check = (err) => { if (err) throw new Error(err); };

  MS.native = {
    available: true,
    _resolve(id, value) {
      const r = pending[id];
      delete pending[id];
      if (r) r(value);
    },
    // ---- Ereignisse von Android
    _battery(level, charging) { MS.device.setBattery({ level, charging }); },
    _notification(n) { MS.bus.emit('notification-posted', n); },
    _bluetooth(connected, name, address) { MS.bus.emit('bluetooth', { connected, name, address }); },
    /** Geräte-Ereignis vom Systemmonitor (Bildschirm, Anruf, SMS, WLAN, NFC …). */
    _event(name, data) {
      if (name === 'shortcut') MS.bus.emit('shortcut', data.id);
      MS.bus.emit('sys:' + name, data || {});
    },
    /** Nach dem Start: Ereignisse abholen, die vor dem Laden der Web-App eintrafen. */
    ready() {
      let list = [];
      try { list = JSON.parse(A.engineReady()); } catch (e) { /* keine */ }
      list.forEach(([name, data]) => this._event(name, data));
    },
    _appChanged(pkg, label, prev) {
      MS.device.foregroundApp = pkg;
      MS.bus.emit('app-changed', { pkg, label, prev });
    },

    // ---- Zeitsteuerung
    delay: (ms) => call('delay', Math.max(0, Number(ms) || 0)),
    setBusy: (busy) => A.setBusy(!!busy),
    scheduleWake: (at) => A.scheduleWake(Number(at) || 0),

    // ---- Gerät
    battery: () => JSON.parse(A.battery()),
    notify: (title, text) => A.showNotification(String(title), String(text)),
    notificationsAllowed: () => A.notificationsAllowed(),
    vibrate: (pattern) => A.vibrate(pattern.join(',')),
    speak(text, lang, rate, pitch, wait) {
      if (wait) return call('speak', String(text), lang, rate, pitch);
      A.speak(String(text), lang, rate, pitch, '');
      return Promise.resolve();
    },
    stopSpeaking: () => A.stopSpeaking(),
    torch: (on) => check(A.torch(on)),
    torchOn: () => A.isTorchOn(),
    keepScreenOn: (on) => A.keepScreenOn(on),
    fullscreen: (on) => A.fullscreen(on),
    isFullscreen: () => A.isFullscreen(),
    setBrightness: (percent, auto) => check(A.setBrightness(Math.round(percent), !!auto)),
    setVolume: (stream, percent) => check(A.setVolume(stream, Math.round(percent))),
    getVolume: (stream) => A.getVolume(stream),
    setRingerMode: (mode) => check(A.setRingerMode(mode)),
    getRingerMode: () => A.getRingerMode(),
    setDnd: (mode) => check(A.setDnd(mode)),
    isDndOn: () => A.isDndOn(),
    mediaControl: (action) => check(A.mediaControl(action)),
    isMusicActive: () => A.isMusicActive(),
    copy: (text) => A.copy(String(text)),
    share: (title, text) => A.share(String(title), String(text)),
    openUrl: (url) => check(A.openUrl(String(url))),
    saveFile: (name, content) => A.saveFile(String(name), String(content)),

    // ---- Apps & Bedienungshilfe
    apps() {
      if (!appList) appList = JSON.parse(A.apps());
      return appList;
    },
    launchApp: (pkg) => check(A.launchApp(String(pkg))),
    foregroundApp: () => A.foregroundApp(),
    systemAction: (action) => check(A.systemAction(action)),
    uiClick: (mode, query, match, longPress, x, y, percent) => check(A.uiClick(mode, String(query), match, !!longPress, Number(x) || 0, Number(y) || 0, !!percent)),
    uiSwipe: (x1, y1, x2, y2, ms, percent) => check(A.uiSwipe(Number(x1), Number(y1), Number(x2), Number(y2), Math.round(ms), !!percent)),
    uiSetText: (text) => check(A.uiSetText(String(text))),
    screenContains: (query, match) => A.screenContains(String(query), match),
    pinUnlock: (pin, enter, digitDelay, swipeDelay) => check(A.pinUnlock(String(pin), !!enter, Math.round(digitDelay || 150), Math.round(swipeDelay || 800))),
    wakeScreen: () => check(A.wakeScreen()),
    foregroundActivity: () => A.foregroundActivity(),
    foregroundAppName: () => A.foregroundAppName(),
    pickImage: () => call('pickImage'),
    imagePreview: (name) => A.imagePreview(String(name)),
    async findImage(name, region, threshold) {
      const res = JSON.parse(await call('findImage', String(name), region || '', Number(threshold)));
      if (res.error) throw new Error(res.error);
      return res;
    },
    isDeviceLocked: () => A.isDeviceLocked(),
    sendIntent: (o) => check(A.sendIntent(o.target, o.action || '', o.data || '', o.mime || '', o.pkg || '', o.cls || '', o.category || '', Math.round(Number(o.flags) || 0), JSON.stringify(o.extras || {}))),

    // ---- Systemzustand & neue Gerätefunktionen
    deviceState() {
      try { return JSON.parse(A.deviceState()); } catch (e) { return {}; }
    },
    setFlag: (key, on) => A.setFlag(key, !!on),
    setTileLabel: (n, label) => A.setTileLabel(n, String(label || '')),
    setWebhook: (port, token) => A.setWebhook(Math.round(Number(port) || 0), String(token || '')),
    localIps: () => JSON.parse(A.localIps()),
    callNumber: (number) => check(A.callNumber(String(number))),
    callControl: (action) => check(A.callControl(action)),
    sendSms: (number, text) => check(A.sendSms(String(number), String(text))),
    notificationDismiss: (pkg, contains) => check(A.notificationDismiss(pkg || '', String(contains || ''))),
    notificationPress: (pkg, contains, button) => check(A.notificationPress(pkg || '', String(contains || ''), String(button || ''))),
    screenText() {
      const r = JSON.parse(A.screenText());
      if (r.error) throw new Error(r.error);
      return r.text;
    },
    async ocr(region) {
      const r = JSON.parse(await call('ocr', region || ''));
      if (r.error) throw new Error(r.error);
      return r.text;
    },
    pickFolder: () => call('pickFolder'),
    fileOp(folder, name, op, text) {
      const r = JSON.parse(A.fileOp(String(folder || ''), String(name || ''), op, String(text ?? '')));
      if (r.error) throw new Error(r.error);
      return r.text;
    },
    async sendMail(o) { check(await call('sendMail', JSON.stringify(o))); },
    calendarEvents(from, to) {
      const r = JSON.parse(A.calendarEvents(Number(from), Number(to)));
      if (r && r.error) throw new Error(r.error);
      return r;
    },
    calendarAdd: (o) => check(A.calendarAdd(String(o.title), String(o.description || ''), String(o.location || ''), Number(o.begin), Number(o.end), !!o.allDay)),
    setWallpaper: (image, which) => check(A.setWallpaper(String(image), which)),
    overlayText: (text, seconds, position, size, color, bg) => check(A.overlayText(String(text), Number(seconds) || 0, position, Math.round(size) || 18, color || '#ffffff', bg || '#cc000000')),
    setSystemSetting: (name, value) => check(A.setSystemSetting(name, Math.round(value))),
    getSystemSetting: (name) => A.getSystemSetting(name),
    openPanel: (which) => check(A.openPanel(which)),
    async shell(cmd, root, timeout) {
      const r = JSON.parse(await call('shell', String(cmd), !!root, Number(timeout) || 30));
      if (r.error && r.out === undefined) throw new Error(r.error);
      return r;
    },
    speechInput: (lang, prompt) => call('speechInput', lang || '', String(prompt || '')),
    async writeNfc(id) { check(await call('writeNfc', String(id))); },
    pinShortcut: (id, label) => check(A.pinShortcut(String(id), String(label || ''))),

    // ---- Berechtigungen & Hintergrund
    permissions: () => JSON.parse(A.permissions()),
    requestPermission: (which) => call('requestPermission', which),
    setBackground: (key, on) => A.setBackground(key, !!on),
    serviceStatus: (text, title) => A.serviceStatus(String(text), String(title || '')),
    startedByBoot: () => A.startedByBoot(),
  };
})();
