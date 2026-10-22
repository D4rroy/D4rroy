/* Makro Studio – Import von MacroDroid-Dateien (.macro / .mdr).
 *
 * MacroDroid speichert Makros als JSON. Jeder Auslöser, jede Aktion und jede Bedingung
 * hat ein Feld „m_classType“. Dieser Konverter übersetzt die bekannten Typen in
 * Makro Studio-Elemente. Nicht übertragbare Aktionen bleiben als Kommentar an ihrer
 * Stelle stehen; der Bericht listet alles auf, was fehlt oder geprüft werden sollte.
 */
'use strict';
(function () {
  const MS = window.MS;
  const { uid } = MS.util;

  // MacroDroid-Variablentypen
  const VAR_TYPES = { 0: 'boolean', 1: 'integer', 2: 'string', 3: 'decimal' };
  // Wochentage in MacroDroid: Montag … Sonntag → JavaScript-getDay()
  const MD_DAYS = [1, 2, 3, 4, 5, 6, 0];

  // Deutsche Namen für häufige MacroDroid-Typen, die sich nicht übertragen lassen
  const LABELS = {
    IncomingCallTrigger: 'Eingehender Anruf', OutgoingCallTrigger: 'Ausgehender Anruf', CallEndedTrigger: 'Anruf beendet', CallMissedTrigger: 'Verpasster Anruf',
    IncomingSMSTrigger: 'SMS empfangen', VolumeButtonTrigger: 'Lautstärketaste', ScreenOnOffTrigger: 'Bildschirm an/aus', WifiConnectionTrigger: 'WLAN-Verbindung',
    HeadphonesTrigger: 'Kopfhörer eingesteckt', NFCTrigger: 'NFC-Tag', ClipboardChangeTrigger: 'Zwischenablage geändert', MusicPlayingTrigger: 'Musik startet/stoppt',
    RejectCallAction: 'Anruf abweisen', AnswerCallAction: 'Anruf annehmen', SendSMSAction: 'SMS senden', UIInteractionAction: 'UI-Interaktion (Klicken/Wischen)',
    AndroidShortcutsAction: 'Android-Verknüpfung', SetWifiAction: 'WLAN schalten', SetBluetoothAction: 'Bluetooth schalten', SetAirplaneModeAction: 'Flugmodus',
    SetMobileDataAction: 'Mobile Daten', ShellScriptAction: 'Shell-Skript', TakePictureAction: 'Foto aufnehmen', RecordMicrophoneAction: 'Ton aufnehmen',
    PhoneRingingConstraint: 'Telefon klingelt', CalendarConstraint: 'Kalendertermin', CallActiveConstraint: 'Telefonat aktiv', WifiConstraint: 'WLAN-Zustand',
    BluetoothConstraint: 'Bluetooth-Zustand', HeadphonesConnectionConstraint: 'Kopfhörer verbunden', ScreenOnOffConstraint: 'Bildschirm an/aus', AirplaneModeConstraint: 'Flugmodus',
  };
  const label = (type) => (LABELS[type] ? `${LABELS[type]} (${type})` : type || 'unbekannt');

  const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
  const pad = MS.util.pad;
  const days = (arr) => (Array.isArray(arr) && arr.length === 7 ? MD_DAYS.filter((_, i) => arr[i]) : [0, 1, 2, 3, 4, 5, 6]);

  function make(kind, type, params, extra) {
    const item = MS.catalog.create(kind, type);
    Object.assign(item.params, params || {});
    return Object.assign(item, extra || {});
  }

  /** Erkennt MacroDroid-Daten (einzelnes Makro, Liste oder Sicherung). */
  function isMacroDroid(data) {
    return !!data && typeof data === 'object' && collectMacros(data).length > 0;
  }

  function looksLikeMacro(m) {
    return m && typeof m === 'object' && (Array.isArray(m.m_triggerList) || Array.isArray(m.m_actionList));
  }

  function collectMacros(data) {
    const out = [];
    if (looksLikeMacro(data)) out.push(data);
    if (looksLikeMacro(data.macro)) out.push(data.macro);
    for (const key of ['macroList', 'macros', 'm_macroList']) {
      if (Array.isArray(data[key])) out.push(...data[key].filter(looksLikeMacro));
    }
    return out;
  }

  function convertVariable(v, report, where) {
    if (!v || typeof v !== 'object' || !v.m_name) return null;
    let type = VAR_TYPES[v.m_type];
    if (!type) {
      type = 'string';
      report.warn(`${where}: Variable „${v.m_name}“ (Liste/Wörterbuch) wurde als Text übernommen.`);
    }
    let value = type === 'boolean' ? !!v.m_booleanValue : type === 'integer' ? num(v.m_intValue) : type === 'decimal' ? num(v.m_decimalValue) : str(v.m_stringValue);
    if (!VAR_TYPES[v.m_type] && v.dictionary && Array.isArray(v.dictionary.entries) && v.dictionary.entries.length) {
      // Einträge als JSON-Text, damit die Inhalte nicht verloren gehen
      try { value = JSON.stringify(v.dictionary.entries.map(dictEntry)); } catch (e) { value = ''; }
    }
    const out = { name: String(v.m_name), type, value };
    if (v.supportsInput && v.supportsOutput) out.io = 'both';
    else if (v.supportsInput) out.io = 'input';
    return out;
  }

  function dictEntry(e) {
    const val = e && e.variable ? e.variable : e;
    if (!val || typeof val !== 'object') return val;
    const t = VAR_TYPES[val.m_type];
    const v = t === 'boolean' ? !!val.m_booleanValue : t === 'integer' ? num(val.m_intValue) : t === 'decimal' ? num(val.m_decimalValue) : t === 'string' ? str(val.m_stringValue) : val.dictionary ? val.dictionary.entries.map(dictEntry) : null;
    return e.key !== undefined ? { [e.key]: v } : v;
  }

  /** Erstes vorhandenes Feld aus einer Liste möglicher Feldnamen. */
  const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };

  const varRef = (v) => (v && v.m_name ? (v.isLocalVar ? 'l:' : 'g:') + v.m_name : '');

  // ------------------------------------------------------------ Auslöser
  const TRIGGERS = {
    TimerTrigger(t, r) {
      if (t.m_useVariable) r.check('Tageszeit nutzte eine Variable – feste Uhrzeit bitte prüfen.');
      return make('trigger', 'time', { time: pad(num(t.m_hour)) + ':' + pad(num(t.m_minute)), days: days(t.m_daysOfWeek) });
    },
    DayTrigger(t, r) { return TRIGGERS.TimerTrigger(t, r); },
    RegularIntervalTrigger(t, r) {
      const n = num(first(t.m_interval, t.m_intervalSeconds, t.interval), 60);
      const unit = { 0: 's', 1: 'min', 2: 'h' }[t.m_unit];
      r.check('Regelmäßiges Intervall: Wert und Einheit bitte prüfen.');
      return unit ? make('trigger', 'interval', { value: n, unit }) : make('trigger', 'interval', n % 60 === 0 ? { value: n / 60, unit: 'min' } : { value: n, unit: 's' });
    },
    SunriseSunsetTrigger(t) {
      return make('trigger', 'sun', { event: num(t.m_option) === 1 ? 'sunset' : 'sunrise', offset: num(first(t.m_timeAdjust, t.m_offset), 0) });
    },
    ShakeDeviceTrigger: () => make('trigger', 'shake', { sensitivity: 'medium' }),
    FlipDeviceTrigger: (t) => make('trigger', 'flip', { state: t.m_faceDown === false ? 'up' : t.m_faceDown === true ? 'down' : 'any' }),
    BatteryLevelTrigger(t, r) {
      r.check('Akkustand: Richtung (fällt/steigt) bitte prüfen.');
      return make('trigger', 'battery_level', { level: num(t.m_batteryLevel, 20), dir: t.m_decreasesTo === false ? 'above' : 'below' });
    },
    ExternalPowerTrigger: (t) => make('trigger', 'power', { state: t.m_connected === false ? 'disconnected' : t.m_connected === true ? 'connected' : 'any' }),
    PowerConnectedTrigger: () => make('trigger', 'power', { state: 'connected' }),
    PowerDisconnectedTrigger: () => make('trigger', 'power', { state: 'disconnected' }),
    BootTrigger: () => make('trigger', 'boot'),
    DeviceBootTrigger: () => make('trigger', 'boot'),
    EmptyTrigger: () => make('trigger', 'empty'),
    ShortcutTrigger: () => make('trigger', 'shortcut'),
    HomeScreenShortcutTrigger: () => make('trigger', 'shortcut'),
    WidgetPressedTrigger: (t) => make('trigger', 'widget', { label: str(first(t.m_widgetName, t.m_name, 'Start')) }),
    FloatingButtonTrigger: (t) => make('trigger', 'widget', { label: str(first(t.m_buttonText, t.m_name, 'Start')) }),
    MacroDroidVariableTrigger(t, r) {
      const v = t.m_variable;
      if (v && v.isLocalVar) r.check('„Variable geändert“ funktioniert nur mit globalen Variablen.');
      return make('trigger', 'variable_change', { var: v && v.m_name ? 'g:' + v.m_name : '', op: 'any' });
    },
    ApplicationLaunchedTrigger(t, r) {
      const pkgs = t.m_packageNameList || [], names = t.m_applicationNameList || [];
      if (pkgs.length > 1) r.check(`App geöffnet/geschlossen: nur die erste von ${pkgs.length} Apps wurde übernommen.`);
      return make('trigger', 'app_changed', { event: t.m_launched === false ? 'close' : 'open', app: str(pkgs[0]), appLabel: str(names[0] || pkgs[0]) });
    },
    NotificationTrigger(t, r) {
      const pkgs = t.m_packageNameList || [], names = t.m_applicationNameList || [];
      if (pkgs.length > 1) r.check(`Benachrichtigung empfangen: nur die erste von ${pkgs.length} Apps wurde übernommen.`);
      return make('trigger', 'notification_received', {
        anyApp: !pkgs.length, app: str(pkgs[0]), appLabel: str(names[0] || pkgs[0]),
        contains: str(first(t.m_text, t.m_notificationText, '')), ignoreOngoing: t.m_ignoreOngoing !== false,
      });
    },
    BluetoothTrigger(t, r) {
      const state = num(t.m_btState);
      if (state !== 2 && state !== 3) r.check('Bluetooth ein-/ausschalten als Auslöser gibt es nicht – als „Gerät verbunden“ übernommen.');
      return make('trigger', 'bluetooth', { state: state === 3 ? 'disconnected' : 'connected', device: t.m_anyDevice ? '' : str(t.m_deviceName) });
    },
    GeofenceTrigger(t, r) {
      r.check('Geofence: Die Koordinaten sind in MacroDroid separat gespeichert – Ort bitte neu festlegen.');
      return make('trigger', 'geofence', { event: t.m_enterArea === false ? 'exit' : 'enter', place: { name: str(t.m_geofenceName), lat: '', lon: '', radius: 150 } });
    },
  };

  // ----------------------------------------------------------- Bedingungen
  function convertConstraint(c, r, ctx) {
    const type = c && c.m_classType;
    const fn = CONSTRAINTS[type];
    if (!fn) {
      r.missing('Bedingung', label(type));
      return null;
    }
    const out = fn(c, r, ctx);
    if (out && c.m_isDisabled) out.enabled = false;
    return out;
  }

  const CONSTRAINTS = {
    TimeOfDayConstraint: (c) => make('constraint', 'time_range', {
      from: pad(num(c.m_startHour)) + ':' + pad(num(c.m_startMinute)),
      to: pad(num(c.m_endHour)) + ':' + pad(num(c.m_endMinute)),
    }),
    WeekdayConstraint: (c) => make('constraint', 'weekday', { days: days(c.m_daysOfWeek) }),
    DayOfWeekConstraint: (c) => make('constraint', 'weekday', { days: days(c.m_daysOfWeek) }),
    BatteryLevelConstraint: (c) => make('constraint', 'battery_level', { op: c.m_greaterThan ? 'gt' : 'lt', level: num(c.m_batteryLevel, 50) }),
    ExternalPowerConstraint: (c) => make('constraint', 'charging', { state: c.m_externalPower === false ? 'not' : 'charging' }),
    ActiveApplicationConstraint(c) {
      const pkgs = c.m_packageNameList || c.packageNameList || [], names = c.m_applicationNameList || c.applicationNameList || [];
      return make('constraint', 'foreground_app', { app: str(pkgs[0]), appLabel: str(names[0] || pkgs[0]) }, { invert: c.m_running === false || c.m_option === 1 });
    },
    DeviceLockedConstraint: (c) => make('constraint', 'device_locked', { state: pick(c, 'm_locked', 'locked') === false || num(c.m_option) === 1 ? 'unlocked' : 'locked' }),
    LastRunTimeConstraint(c, r, ctx) {
      const secs = num(pick(c, 'm_timePeriodSeconds', 'm_seconds', 'timePeriodSeconds', 'm_time'), 0) + num(c.m_minutes) * 60 + num(c.m_hours) * 3600 + num(c.m_days) * 86400;
      const guid = pick(c, 'm_macroGuid', 'macroGuid', 'm_GUID');
      const name = pick(c, 'm_macroName', 'macroName');
      r.check('Zuletzt ausgeführt: Zeitraum und Richtung bitte prüfen.');
      const unit = secs % 3600 === 0 && secs ? ['h', secs / 3600] : secs % 60 === 0 && secs ? ['min', secs / 60] : ['s', secs];
      return make('constraint', 'last_run', {
        macro: name || guid !== undefined ? ctx.macroRef(name, guid) || '__this' : '__this',
        op: c.m_notRunInPeriod === false || num(c.m_option) === 1 ? 'less' : 'more', value: unit[1], unit: unit[0],
      });
    },
    CompareValueConstraint(c, r) {
      const ops = { 0: 'eq', 1: 'ne', 2: 'lt', 3: 'gt', 4: 'le', 5: 'ge' };
      let left = pick(c, 'm_value1', 'value1', 'lhsValue', 'leftValue', 'm_firstValue', 'm_text');
      let right = pick(c, 'm_value2', 'value2', 'rhsValue', 'rightValue', 'm_secondValue', 'm_compareValue');
      if (left === undefined || right === undefined) {
        // Unbekannte Feldnamen: die ersten beiden Textfelder verwenden
        const texts = Object.entries(c).filter(([k, v]) => typeof v === 'string' && !/^m_classType$|comment|Name$/i.test(k)).map(([, v]) => v);
        left = left === undefined ? texts[0] : left;
        right = right === undefined ? texts[1] : right;
      }
      r.check('Werte vergleichen: Werte und Vergleichsart bitte prüfen.');
      return make('constraint', 'compare_values', { left: str(left), op: ops[num(pick(c, 'm_option', 'comparison', 'operator'))] || 'eq', right: str(right) });
    },
    MusicActiveConstraint: (c) => make('constraint', 'music_active', { state: c.m_musicActive === false ? 'no' : 'yes' }),
    OrientationConstraint: (c) => make('constraint', 'orientation', { state: c.m_portrait === false ? 'landscape' : 'portrait' }),
    ApplicationRunningConstraint(c, r) {
      const pkgs = c.m_packageNameList || [], names = c.m_applicationNameList || [];
      return make('constraint', 'foreground_app', { app: str(pkgs[0]), appLabel: str(names[0] || pkgs[0]) }, { invert: c.m_running === false });
    },
    MacroEnabledConstraint: (c, r, ctx) => make('constraint', 'macro_state', { macro: ctx.macroRef(c.m_macroName, c.m_GUID), state: c.m_enabled === false ? 'off' : 'on' }),
    MacroDroidVariableConstraint(c, r) {
      const v = c.m_variable || {};
      const ops = { 0: 'eq', 1: 'ne', 2: 'lt', 3: 'gt', 4: 'le', 5: 'ge' };
      let value = first(c.m_stringComparisonValue, c.m_intComparisonValue, c.m_doubleComparisonValue, c.m_comparisonValue);
      if (VAR_TYPES[v.m_type] === 'boolean') value = c.m_booleanValue === false ? 'false' : 'true';
      if (c.m_option !== undefined && !(num(c.m_option) in ops)) r.check(`Variablen-Bedingung „${v.m_name}“: Vergleichsart bitte prüfen.`);
      return make('constraint', 'variable', { var: varRef(v), op: ops[num(c.m_option)] || 'eq', value: str(value === undefined ? '' : value) });
    },
    TriggerThatInvokedConstraint: (c, r, ctx) => make('constraint', 'trigger_fired', { trigger: ctx.triggerRef(c.m_siGuidThatInvoked), triggerLabel: str(c.m_triggerName) }, { invert: !!c.m_not }),
    LogicConstraint(c, r, ctx) {
      // NICHT mit einer Bedingung lässt sich direkt abbilden, alles andere nur näherungsweise
      const inner = (c.m_constraintList || []).map((x) => convertConstraint(x, r, ctx)).filter(Boolean);
      if (inner.length === 1 && num(c.m_option) === 3) return Object.assign(inner[0], { invert: !inner[0].invert });
      r.check('Verschachtelte Logik-Bedingung (UND/ODER/XOR) wurde vereinfacht – bitte prüfen.');
      return inner[0] || null;
    },
  };

  // --------------------------------------------------------------- Aktionen
  /** Liefert ein oder mehrere Makro Studio-Aktionen für eine MacroDroid-Aktion. */
  function convertAction(a, r, ctx) {
    const type = a && a.m_classType;
    const fn = ACTIONS[type];
    let out;
    if (fn) out = fn(a, r, ctx);
    if (!out) {
      if (!fn) r.missing('Aktion', label(type));
      out = [make('action', 'comment', { text: `Aus MacroDroid nicht übernommen: ${label(type)}${a && a.m_comment ? ' – ' + a.m_comment : ''}` })];
    }
    out = Array.isArray(out) ? out : [out];
    if (a.m_isDisabled) out.forEach((x) => { if (!MS.catalog.actions[x.type].flow) x.enabled = false; });
    // MacroDroid-Bedingungen an einer einzelnen Aktion → Wenn-Block um die Aktion
    const own = (a.m_constraintList || []);
    const isFlow = /^(If|ElseIf|Loop)/.test(type) || /ConditionAction$/.test(type);
    if (own.length && !isFlow) {
      const conditions = own.map((c) => convertConstraint(c, r, ctx)).filter(Boolean);
      if (conditions.length) {
        out = [make('action', 'if', { conditions, logic: a.m_isOrCondition ? 'or' : 'and' }), ...out, make('action', 'end_if')];
      }
    }
    return out;
  }

  const conds = (a, r, ctx) => ({ conditions: (a.m_constraintList || []).map((c) => convertConstraint(c, r, ctx)).filter(Boolean), logic: a.m_isOrCondition ? 'or' : 'and' });

  const ACTIONS = {
    // Ablaufsteuerung
    IfConditionAction: (a, r, ctx) => make('action', 'if', conds(a, r, ctx)),
    ElseIfConditionAction: (a, r, ctx) => make('action', 'else_if', conds(a, r, ctx)),
    ElseAction: () => make('action', 'else'),
    ElseParentAction: () => make('action', 'else'),
    EndIfAction: () => make('action', 'end_if'),
    LoopAction(a, r, ctx) {
      const c = conds(a, r, ctx);
      if (num(a.m_option) === 0) return make('action', 'loop', { mode: 'count', count: num(a.m_fixedOptionCount, 1) });
      if (c.conditions.length) return make('action', 'loop', Object.assign({ mode: 'while' }, c));
      r.check('Schleife: Wiederholungsart bitte prüfen (als „endlos“ übernommen).');
      return make('action', 'loop', { mode: 'forever' });
    },
    EndLoopAction: () => make('action', 'end_loop'),
    BreakFromLoopAction: () => make('action', 'break_loop'),
    ContinueLoopAction: () => make('action', 'continue_loop'),
    PauseAction(a) {
      const ms = num(a.m_delayInMilliSeconds) + num(a.m_delayInSeconds) * 1000 + num(a.m_delayInMinutes) * 60000 + num(a.m_delayInHours) * 3600000;
      return ms % 1000 ? make('action', 'wait', { value: ms, unit: 'ms' }) : make('action', 'wait', { value: ms / 1000, unit: 's' });
    },
    WaitUntilTriggerAction: (a, r) => { r.check('„Warten auf Auslöser“ gibt es nicht – als 5 s Warten übernommen.'); return make('action', 'wait', { value: 5, unit: 's' }); },

    // Benachrichtigungen & Anzeige
    NotificationAction: (a) => make('action', 'notification', { title: str(first(a.m_notificationSubject, a.m_title, 'Makro Studio')), text: str(first(a.m_notificationText, a.m_text, '')) }),
    ToastAction: (a) => make('action', 'toast', { text: str(first(a.m_messageText, a.m_toastText, a.m_text, '')), duration: a.m_duration === 1 ? 'long' : 'short' }),
    SpeakTextAction: (a) => make('action', 'speak', { text: str(first(a.m_textToSay, a.m_text, '')), wait: !!a.m_queue || a.m_waitToFinish !== false }),
    VibrateAction: () => make('action', 'vibrate', { pattern: 'short' }),
    PlaySoundAction: (a, r) => { r.check(`Ton abspielen: MacroDroid-Ton „${str(a.m_filePath) || '?'}“ durch eingebauten Ton ersetzt.`); return make('action', 'play_sound', { sound: 'chime', wait: !!a.waitToFinish }); },
    CameraFlashLightAction: (a) => make('action', 'torch', { state: ({ 0: 'on', 1: 'off', 2: 'toggle' })[num(a.m_state)] || 'toggle' }),
    ClipboardAction: (a) => make('action', 'clipboard', { text: str(a.m_clipboardText) }),
    LogAction: (a) => make('action', 'log', { text: str(first(a.m_logText, a.m_text, '')), level: 'user' }),
    CommentAction: (a) => make('action', 'comment', { text: str(first(a.m_comment, a.m_text, '')) }),

    // Apps & System
    LaunchActivityAction: (a) => make('action', 'launch_app', { app: str(a.m_packageToLaunch), appLabel: str(a.m_applicationName) }),
    LaunchAppActivityAction: (a) => make('action', 'launch_app', { app: str(a.packageToLaunch), appLabel: str(a.applicationName) }),
    LaunchHomeScreenAction: () => make('action', 'system_action', { action: 'home' }),
    ExpandCollapseStatusBarAction: (a, r) => {
      if (num(a.m_option) !== 0) r.check('Statusleiste: Zuklappen gibt es nicht – als „Benachrichtigungen öffnen“ übernommen.');
      return make('action', 'system_action', { action: 'notifications' });
    },
    ScreenOnAction: (a) => (a.m_screenOff || a.m_screenOffNoLock ? make('action', 'system_action', { action: 'lock_screen' }) : null),
    TakeScreenshotAction: () => make('action', 'system_action', { action: 'screenshot' }),
    OpenWebPageAction: (a) => make('action', 'open_url', { url: str(first(a.m_url, a.url, 'https://')), newTab: true }),
    HttpRequestAction(a, r) {
      const cfg = a.requestConfig || a.m_requestConfig || {};
      r.check('HTTP-Anfrage: Header, Inhalt und Ergebnis-Variablen bitte prüfen.');
      return make('action', 'http_request', { method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][num(cfg.requestType)] || 'GET', url: str(first(cfg.urlToOpen, a.m_url, 'https://')), body: str(first(cfg.contentBodyText, '')) });
    },
    SetBrightnessAction: (a) => make('action', 'brightness', { auto: !!a.m_autoBrightness, percent: num(first(a.m_brightnessPercent, a.m_brightness), 50) }),
    SilentModeVibrateOffAction: (a, r) => { r.check('Klingelmodus: gewählten Modus bitte prüfen.'); return make('action', 'ringer_mode', { mode: ({ 0: 'silent', 1: 'vibrate', 2: 'normal' })[num(first(a.option, a.m_option))] || 'silent' }); },
    VibrateEnableDisableAction: (a) => make('action', 'ringer_mode', { mode: num(a.m_option) === 1 ? 'normal' : 'vibrate' }),
    SetVolumeAction: (a, r) => { r.check('Lautstärke: Kanal und Wert bitte prüfen.'); return make('action', 'volume', { stream: 'media', percent: num(first((a.m_streamVolumeArray || [])[0], a.m_volume), 50) }); },
    ControlMediaAction(a, r) {
      const map = { 0: 'next', 1: 'play_pause', 2: 'previous', 3: 'play', 4: 'pause', 5: 'stop' };
      if (!(num(a.optionInt) in map)) r.check(`Mediensteuerung „${str(a.m_option)}“ bitte prüfen.`);
      if (a.m_packageName) r.check(`Mediensteuerung: Befehl geht an die aktive Medien-App, nicht gezielt an ${str(a.m_applicationName || a.m_packageName)}.`);
      return make('action', 'media_control', { action: map[num(a.optionInt)] || 'play_pause' });
    },
    UIInteractionAction(a, r) {
      const cfg = a.uiInteractionConfiguration || {};
      const type = String(cfg.type || 'Click');
      if (/swipe|gesture/i.test(type)) {
        r.check('UI-Interaktion (Wischen): Start- und Endpunkt bitte prüfen.');
        return make('action', 'ui_interaction', { mode: 'swipe', percent: true, x1: 50, y1: 80, x2: 50, y2: 20, duration: 300 });
      }
      if (/paste|text/i.test(type) && !/click/i.test(type)) {
        return make('action', 'ui_interaction', { mode: 'set_text', text: str(pick(cfg, 'textToPaste', 'text', 'textContent')) });
      }
      if (!/click/i.test(type)) r.check(`UI-Interaktion „${type}“ als Tippen übernommen – bitte prüfen.`);
      const mode = cfg.longClick ? 'long_click' : 'click';
      const opt = num(cfg.clickOption);
      const pt = cfg.xyPoint || {};
      if (cfg.textContent && opt !== 0) {
        const idLike = /:id\//.test(cfg.textContent) || opt === 2;
        return make('action', 'ui_interaction', { mode, target: idLike ? 'id' : 'text', query: str(cfg.textContent), match: cfg.useRegex ? 'regex' : num(cfg.textMatchOption) === 0 ? 'exact' : 'contains' });
      }
      if (cfg.viewId) return make('action', 'ui_interaction', { mode, target: 'id', query: str(cfg.viewId) });
      return make('action', 'ui_interaction', { mode, target: 'coords', x: num(pt.x), y: num(pt.y), percent: !!cfg.xyPercentages });
    },
    PinUnlockAction(a, r) {
      r.check('Mit PIN entsperren: Die PIN ist in MacroDroid verschlüsselt gespeichert – bitte im Makro neu eintragen.');
      return make('action', 'pin_unlock', { pin: '', enter: true });
    },
    SendIntentAction(a, r) {
      const extras = [];
      for (let i = 1; i <= 5; i++) {
        const k = pick(a, `m_extra${i}Name`, `extra${i}Name`), v = pick(a, `m_extra${i}Value`, `extra${i}Value`);
        if (k) extras.push(`${k}=${str(v)}`);
      }
      if (Array.isArray(a.extras)) a.extras.forEach((e) => e && e.name && extras.push(`${e.name}=${str(e.value)}`));
      r.check('Intent senden: Ziel, Action und Extras bitte prüfen.');
      return make('action', 'send_intent', {
        target: ({ 0: 'activity', 1: 'service', 2: 'broadcast' })[num(pick(a, 'm_target', 'target', 'm_option'))] || 'activity',
        action: str(pick(a, 'm_action', 'action')), data: str(pick(a, 'm_data', 'data', 'm_uri')), mime: str(pick(a, 'm_mimeType', 'mimeType')),
        pkg: str(pick(a, 'm_packageName', 'packageName')), cls: str(pick(a, 'm_className', 'className')), extras: extras.join('\n'),
      });
    },
    MacroDroidNotificationTextAction: (a) => make('action', 'service_text', { text: str(pick(a, 'm_text', 'm_notificationText', 'text', 'notificationText')) }),
    ActionGroupAction: (a) => make('action', 'group', { name: str(pick(a, 'm_name', 'groupName', 'name', 'm_comment')) || 'Gruppe' }),
    ActionGroupEndAction: () => make('action', 'end_group'),
    SeparatorAction: (a) => make('action', 'comment', { text: '———— ' + str(pick(a, 'm_text', 'text', 'm_comment') || '') }),
    CheckImageOnScreenAction(a, r) {
      r.check('„Bild auf dem Bildschirm prüfen“: Das Vergleichsbild ist nicht in der .macro-Datei enthalten. Als Ersatz gibt es die Bedingung „Text auf dem Bildschirm“.');
      return make('action', 'comment', { text: 'MacroDroid: Bild auf dem Bildschirm prüfen – nicht möglich (Vergleichsbild fehlt). Ersatz: Bedingung „Text auf dem Bildschirm“ in einem Wenn-Block.' });
    },
    KeepAwakeAction: (a) => make('action', 'wake_lock', { state: a.m_enabled === false ? 'off' : 'on' }),

    // Variablen & Text
    SetVariableAction(a, r) {
      const v = a.m_variable || {};
      const ref = varRef(v);
      const type = VAR_TYPES[v.m_type];
      if (a.m_userPrompt) {
        return make('action', 'input_dialog', { title: str(first(a.m_userPromptTitle, v.m_name)), message: str(a.m_userPromptMessage), var: ref, inputType: type === 'string' ? 'text' : 'number', onCancel: a.m_userPromptStopAfterCancel === false ? 'continue' : 'stop' });
      }
      if (type === 'boolean') return a.m_booleanInvert ? make('action', 'set_variable', { var: ref, op: 'toggle' }) : make('action', 'set_variable', { var: ref, op: 'set', value: String(!!a.m_newBooleanValue) });
      if (type === 'integer' || type === 'decimal') {
        if (a.m_intValueIncrement) return make('action', 'set_variable', { var: ref, op: 'inc', amount: 1 });
        if (a.m_intValueDecrement) return make('action', 'set_variable', { var: ref, op: 'dec', amount: 1 });
        if (a.m_intRandom) return make('action', 'set_variable', { var: ref, op: 'random', min: num(a.m_intRandomMin), max: num(a.m_intRandomMax) });
        if (a.m_intExpression) return make('action', 'set_variable', { var: ref, op: 'expr', expr: str(first(a.m_intExpressionText, a.m_newStringValue, a.m_expression, '0')) });
        return make('action', 'set_variable', { var: ref, op: 'set', value: String(type === 'integer' ? num(a.m_newIntValue) : num(a.m_newDoubleValue)) });
      }
      if (!type) r.check(`Variable „${v.m_name}“: Listen/Wörterbücher werden nicht unterstützt.`);
      return make('action', 'set_variable', { var: ref, op: 'set', value: str(a.m_newStringValue) });
    },
    TextManipulationAction(a, r) {
      const tm = a.m_textManipulation || {}, p = tm.params || [];
      const target = varRef(a.m_variable) || (a.variableName ? 'l:' + a.variableName : '');
      const base = { source: str(a.m_text), var: target };
      switch (tm.type) {
        case 'UpperCaseManipulation': return make('action', 'text_manipulation', Object.assign(base, { op: 'upper' }));
        case 'LowerCaseManipulation': return make('action', 'text_manipulation', Object.assign(base, { op: 'lower' }));
        case 'TrimManipulation': return make('action', 'text_manipulation', Object.assign(base, { op: 'trim' }));
        case 'ReplaceAllManipulation': return make('action', 'text_manipulation', Object.assign(base, { op: 'replace', find: str(p[0]), with: str(p[1]) }));
        case 'SubstringManipulation': return make('action', 'text_manipulation', Object.assign(base, { op: 'substring', start: num(p[0]), len: Math.max(0, num(p[1]) - num(p[0])) }));
        case 'ExtractTextManipulation': return make('action', 'text_manipulation', Object.assign(base, { op: 'regex', pattern: str(p[0]) }));
        default:
          r.check(`Text bearbeiten: Vorgang „${tm.type || '?'}“ bitte prüfen.`);
          return make('action', 'text_manipulation', Object.assign(base, { op: 'trim' }));
      }
    },

    // Dialoge
    OptionDialogAction(a, r, ctx) {
      // Auswahl in einer lokalen Variable speichern, danach je Knopf ein Wenn-Zweig
      const buttons = (a.m_buttonNames || []).map((b, i) => [i, str(b)]).filter(([, b]) => b);
      const name = ctx.addLocal('auswahl', 'string');
      const out = [make('action', 'options_dialog', { title: str(a.m_title), options: buttons.map(([, b]) => b).join('\n'), var: 'l:' + name, onCancel: 'stop' })];
      let firstBranch = true;
      for (const [i, label] of buttons) {
        const json = (a.m_actionToRunJson || [])[i];
        if (!json) continue;
        let inner;
        try { inner = JSON.parse(json); } catch (e) { continue; }
        const cond = make('constraint', 'variable', { var: 'l:' + name, op: 'eq', value: label });
        out.push(make('action', firstBranch ? 'if' : 'else_if', { conditions: [cond], logic: 'and' }));
        out.push(...convertAction(inner, r, ctx));
        firstBranch = false;
      }
      if (!firstBranch) out.push(make('action', 'end_if'));
      return out;
    },
    ConfirmNextAction: (a) => make('action', 'confirm_dialog', { title: str(first(a.m_title, 'Fortfahren?')), message: str(a.m_message), stopOnNo: true }),

    // Makros
    DisableMacroAction: (a, r, ctx) => make('action', 'set_macro_enabled', { macro: ctx.macroRef(a.m_macroName, a.m_GUID), state: ({ 0: 'on', 1: 'off', 2: 'toggle' })[num(a.m_state)] || 'toggle' }),
    MacroDroidDisableAction: (a) => make('action', 'set_engine', { state: a.m_disable === false ? 'on' : 'off' }),
    InvokeMacroAction: (a, r, ctx) => make('action', 'run_macro', { macro: ctx.macroRef(a.m_macroName, a.m_GUID), ignoreConstraints: !!a.m_ignoreConstraints, wait: true }),
    RunMacroAction: (a, r, ctx) => ACTIONS.InvokeMacroAction(a, r, ctx),
    CancelActiveMacroAction: () => make('action', 'cancel_actions', { target: 'this' }),
    ActionBlockAction: (a, r, ctx) => {
      r.check('Action Block: Ein- und Ausgaben bitte neu zuordnen.');
      return make('action', 'action_block', { block: ctx.blockRef(first(a.actionBlockName, a.m_actionBlockName), first(a.actionBlockGuid, a.m_GUID)) });
    },
  };

  // ------------------------------------------------------------- Umwandlung
  /** Wandelt MacroDroid-Daten um → { macros, blocks, variables, report: [{name, notes}] }. */
  function convert(data) {
    const sources = collectMacros(data);
    const blockSources = [];
    for (const s of [data, data.macro].filter(Boolean)) if (Array.isArray(s.exportedActionBlocks)) blockSources.push(...s.exportedActionBlocks);
    if (Array.isArray(data.actionBlocks)) blockSources.push(...data.actionBlocks);

    // IDs vorab vergeben, damit Verweise zwischen Makros (per Name oder GUID) aufgelöst werden können
    const idByName = {}, idByGuid = {}, blockByName = {}, blockByGuid = {};
    const plan = sources.map((m) => ({ m, id: uid() }));
    plan.forEach(({ m, id }) => { idByName[m.m_name] = id; idByGuid[String(m.m_GUID)] = id; });
    const blockPlan = blockSources.filter(looksLikeMacro).map((b) => ({ m: b, id: uid() }));
    blockPlan.forEach(({ m, id }) => { blockByName[m.m_name] = id; blockByGuid[String(m.m_GUID)] = id; });

    const variables = [];
    for (const v of data.globalVariables || data.m_variables || []) {
      const out = convertVariable(v, { warn: () => {} }, 'Global');
      if (out) variables.push({ name: out.name, type: out.type, value: out.value });
    }

    const report = [];
    function build(m, id, isBlock) {
      const notes = { missing: [], check: [] };
      const r = {
        missing: (kind, what) => notes.missing.push(`${kind} „${what}“`),
        check: (msg) => notes.check.push(msg),
        warn: (msg) => notes.check.push(msg),
      };
      const locals = (m.localVariables || []).map((v) => convertVariable(v, r, m.m_name)).filter(Boolean);
      const triggerIds = {};
      const ctx = {
        macroRef(name, guid) {
          const hit = idByGuid[String(guid)] || idByName[name] || (MS.store.state.macros.find((x) => x.name === name) || {}).id;
          if (!hit) r.check(`Verweis auf Makro „${name || '?'}“ – dieses Makro bitte auswählen.`);
          return hit || '';
        },
        blockRef(name, guid) {
          const hit = blockByGuid[String(guid)] || blockByName[name] || (MS.store.state.blocks.find((x) => x.name === name) || {}).id;
          if (!hit) r.check(`Action Block „${name || '?'}“ wurde nicht mitexportiert.`);
          return hit || '';
        },
        triggerRef: (guid) => triggerIds[String(guid)] || '',
        addLocal(base, type) {
          let name = base, n = 2;
          while (locals.some((v) => v.name === name)) name = base + n++;
          locals.push({ name, type, value: type === 'string' ? '' : 0 });
          return name;
        },
      };

      const triggers = [];
      for (const t of m.m_triggerList || []) {
        const fn = TRIGGERS[t.m_classType];
        if (!fn) { r.missing('Auslöser', label(t.m_classType)); continue; }
        const item = fn(t, r);
        if (!item) continue;
        if (t.m_isDisabled) item.enabled = false;
        triggerIds[String(t.m_SIGUID)] = item.id;
        if ((t.m_constraintList || []).length) r.check(`Bedingungen am Auslöser „${MS.catalog.triggers[item.type].name}“ wurden nicht übernommen.`);
        triggers.push(item);
      }
      const constraints = (m.m_constraintList || []).map((c) => convertConstraint(c, r, ctx)).filter(Boolean);
      const actions = [];
      for (const a of m.m_actionList || []) actions.push(...convertAction(a, r, ctx));

      report.push({ name: m.m_name || 'Unbenannt', block: isBlock, triggers: triggers.length, actions: actions.length, constraints: constraints.length, missing: notes.missing, check: [...new Set(notes.check)] });
      if (isBlock) return { id, name: str(m.m_name) || 'Action Block', description: str(m.m_description), actions, localVars: locals };
      const category = str(m.m_category) || 'MacroDroid';
      return {
        id, name: str(m.m_name) || 'Importiertes Makro', description: str(m.m_description), category,
        enabled: m.m_enabled !== false, triggers, actions, constraints,
        constraintLogic: m.m_isOrCondition ? 'or' : 'and',
        localVars: locals.map(({ name, type, value }) => ({ name, type, value })),
        created: Date.now(),
      };
    }

    const blocks = blockPlan.map(({ m, id }) => build(m, id, true));
    const macros = plan.map(({ m, id }) => build(m, id, false));
    return { macros, blocks, variables, report };
  }

  MS.macrodroid = { isMacroDroid, convert, TRIGGERS, ACTIONS, CONSTRAINTS };
})();
