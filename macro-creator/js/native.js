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
    _appChanged(pkg, label, prev) {
      MS.device.foregroundApp = pkg;
      MS.bus.emit('app-changed', { pkg, label, prev });
    },

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

    // ---- Berechtigungen & Hintergrund
    permissions: () => JSON.parse(A.permissions()),
    requestPermission: (which) => call('requestPermission', which),
    setBackground: (key, on) => A.setBackground(key, !!on),
    serviceStatus: (text, title) => A.serviceStatus(String(text), String(title || '')),
    startedByBoot: () => A.startedByBoot(),
  };
})();
