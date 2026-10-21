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
    /** Wird von Android bei jeder Akkuänderung aufgerufen. */
    _battery(level, charging) { MS.device.setBattery({ level, charging }); },
    battery: () => JSON.parse(A.battery()),
    notify: (title, text) => A.showNotification(String(title), String(text)),
    notificationsAllowed: () => A.notificationsAllowed(),
    requestPermission: (which) => call('requestPermission', which),
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
    copy: (text) => A.copy(String(text)),
    share: (title, text) => A.share(String(title), String(text)),
    openUrl: (url) => check(A.openUrl(String(url))),
    saveFile: (name, content) => A.saveFile(String(name), String(content)),
  };
})();
