/* Makro Studio – Berechtigungen der Android-App: wofür sie gebraucht werden und wo man
 * sie einstellt. Dient der Seite „Berechtigungen“ und der Einrichtungsanleitung (PDF). */
'use strict';
(function () {
  const MS = window.MS;
  const APP = 'Einstellungen → Apps → Makro Studio';

  MS.PERMISSIONS = [
    {
      key: 'notifications', title: 'Benachrichtigungen', icon: 'notifications_active',
      why: 'Damit Makros Benachrichtigungen anzeigen können und der Hintergrunddienst seine Daueranzeige „Makro Studio läuft“ zeigen kann.',
      uses: ['Benachrichtigung anzeigen', 'Hintergrunddienst'],
      steps: [
        'In Makro Studio unter „Berechtigungen“ bei „Benachrichtigungen“ auf „Einrichten“ tippen und „Zulassen“ wählen.',
        `Falls keine Abfrage erscheint: ${APP} → Benachrichtigungen → „Benachrichtigungen zulassen“ (bzw. „Alle Makro Studio-Benachrichtigungen“) einschalten.`,
      ],
    },
    {
      key: 'location', title: 'Standort', icon: 'location_on',
      why: 'Für Ort-Auslöser (Geofence), die Bedingung „Ort“, die Aktion „Standort abrufen“ und Sonnenauf-/-untergang ohne festen Standort.',
      uses: ['Geofence', 'Ort (Bedingung)', 'Standort abrufen', 'Sonnenaufgang/-untergang'],
      steps: [
        'Auf „Einrichten“ tippen und „Bei Nutzung der App“ wählen. „Genauer Standort“ eingeschaltet lassen.',
        `Manuell: ${APP} → Berechtigungen → Standort → „Nur während der Nutzung der App zulassen“ und „Genauen Standort verwenden“ einschalten.`,
      ],
    },
    {
      key: 'background_location', title: 'Standort im Hintergrund', icon: 'share_location', minSdk: 29,
      why: 'Damit Geofences auch auslösen, wenn Makro Studio nicht geöffnet ist. Voraussetzung: „Standort“ ist bereits erlaubt.',
      uses: ['Geofence im Hintergrund'],
      steps: [
        'Zuerst „Standort“ erlauben.',
        'Dann auf „Einrichten“ tippen. Android öffnet die Standort-Einstellung der App – dort „Immer zulassen“ wählen.',
        `Manuell: ${APP} → Berechtigungen → Standort → „Immer zulassen“.`,
      ],
    },
    {
      key: 'battery', title: 'Akku-Optimierung ausschalten', icon: 'battery_saver',
      why: 'Sonst pausiert oder beendet Android den Hintergrunddienst im Energiesparmodus, und zeitgesteuerte Makros setzen aus.',
      uses: ['Hintergrunddienst', 'Tageszeit', 'Regelmäßiges Intervall', 'alle Auslöser im Hintergrund'],
      steps: [
        'Auf „Einrichten“ tippen und die Frage „Akku-Optimierung beenden?“ mit „Zulassen“ beantworten.',
        `Manuell: ${APP} → Akku → „Nicht eingeschränkt“ (je nach Version „Uneingeschränkt“ oder „Nicht optimieren“).`,
        'Bei Samsung, Xiaomi, Huawei und OnePlus zusätzlich die Hersteller-Tipps unten beachten.',
      ],
    },
    {
      key: 'accessibility', title: 'Bedienungshilfe', icon: 'accessibility_new', restricted: true,
      why: 'Erkennt, welche App gerade geöffnet ist, und führt Systemaktionen aus. Erlaubt außerdem, Apps und Websites aus dem Hintergrund zu öffnen. Makro Studio liest dabei keine Bildschirminhalte.',
      uses: ['App geöffnet/geschlossen', 'App im Vordergrund (Bedingung)', 'Systemaktion', 'App starten / Website öffnen im Hintergrund'],
      steps: [
        'Auf „Einrichten“ tippen – die Seite „Bedienungshilfen“ öffnet sich.',
        '„Installierte Apps“ bzw. „Heruntergeladene Apps“ öffnen → „Makro Studio“ → einschalten → bestätigen.',
        'Ist der Schalter ausgegraut („Eingeschränkte Einstellung“), siehe den Abschnitt „Eingeschränkte Einstellungen freigeben“.',
      ],
    },
    {
      key: 'notification_listener', title: 'Benachrichtigungszugriff', icon: 'mark_chat_unread', restricted: true,
      why: 'Damit Makros auf eingehende Benachrichtigungen anderer Apps reagieren können (z. B. WhatsApp, E-Mail).',
      uses: ['Benachrichtigung empfangen'],
      steps: [
        'Auf „Einrichten“ tippen – die Liste „Benachrichtigungszugriff“ öffnet sich.',
        '„Makro Studio“ antippen → „Benachrichtigungszugriff zulassen“ einschalten → bestätigen.',
        'Manuell: Einstellungen → Benachrichtigungen → (Erweiterte Einstellungen bzw. „Geräte- und App-Benachrichtigungen“) → Benachrichtigungszugriff → Makro Studio.',
        'Ist der Schalter ausgegraut, siehe „Eingeschränkte Einstellungen freigeben“.',
      ],
    },
    {
      key: 'bluetooth', title: 'Geräte in der Nähe (Bluetooth)', icon: 'bluetooth', minSdk: 31,
      why: 'Damit Makros erkennen, wenn sich ein Bluetooth-Gerät (Kopfhörer, Auto, Uhr) verbindet oder trennt.',
      uses: ['Bluetooth-Gerät verbunden/getrennt'],
      steps: [
        'Auf „Einrichten“ tippen und „Zulassen“ wählen.',
        `Manuell: ${APP} → Berechtigungen → Geräte in der Nähe → „Zulassen“.`,
      ],
    },
    {
      key: 'dnd', title: '„Bitte nicht stören“-Zugriff', icon: 'do_not_disturb_on',
      why: 'Erlaubt Makros, „Bitte nicht stören“ zu schalten und das Telefon lautlos zu stellen.',
      uses: ['Nicht stören', 'Klingelmodus (Lautlos)', 'Lautstärke (Klingelton auf 0)'],
      steps: [
        'Auf „Einrichten“ tippen → „Makro Studio“ → „Zugriff auf ‚Bitte nicht stören‘ erlauben“ einschalten.',
        'Manuell: Einstellungen → Apps → Spezieller App-Zugriff → „Bitte nicht stören“-Zugriff (bzw. „Zugriff auf Nicht stören“) → Makro Studio.',
      ],
    },
    {
      key: 'write_settings', title: 'Systemeinstellungen ändern', icon: 'brightness_6',
      why: 'Wird für die Aktion „Bildschirmhelligkeit“ benötigt.',
      uses: ['Bildschirmhelligkeit'],
      steps: [
        'Auf „Einrichten“ tippen → „Änderung von Systemeinstellungen zulassen“ einschalten.',
        'Manuell: Einstellungen → Apps → Spezieller App-Zugriff → Systemeinstellungen ändern → Makro Studio.',
      ],
    },
    {
      key: 'overlay', title: 'Über anderen Apps einblenden', icon: 'layers',
      why: 'Android erlaubt Apps im Hintergrund nicht, andere Apps zu öffnen. Mit dieser Berechtigung (oder der Bedienungshilfe) klappen „App starten“, „Website öffnen“, „Anrufen“ usw. auch, wenn Makro Studio nicht sichtbar ist.',
      uses: ['App starten', 'Website öffnen', 'Anrufen / SMS / E-Mail', 'Navigation starten'],
      steps: [
        'Auf „Einrichten“ tippen → „Makro Studio“ → „Über anderen Apps einblenden“ erlauben.',
        'Manuell: Einstellungen → Apps → Spezieller App-Zugriff → Über anderen Apps einblenden → Makro Studio.',
      ],
    },
  ];

  MS.SETUP_GUIDE = {
    install: [
      'Auf dem Handy die Release-Seite öffnen: github.com/D4rroy/D4rroy/releases/tag/apk-latest',
      '„MakroStudio.apk“ herunterladen und die Datei öffnen.',
      'Wenn Android fragt: „Einstellungen“ → „Dieser Quelle vertrauen“ bzw. „Apps aus dieser Quelle zulassen“ einschalten, zurück und „Installieren“.',
      'Warnt Google Play Protect, „Weitere Details“ → „Trotzdem installieren“ wählen (die App stammt nicht aus dem Play Store).',
      'Updates einfach genauso über die bestehende App installieren – Makros und Variablen bleiben erhalten.',
    ],
    background: [
      'Makro Studio öffnen → Einstellungen → „Hintergrunddienst“ einschalten. In der Statusleiste erscheint „Makro Studio läuft“.',
      '„Beim Gerätestart starten“ einschalten, damit der Dienst nach einem Neustart automatisch läuft (Auslöser „Gerät gestartet“).',
      'Optional „CPU wach halten“: Makros laufen auch bei ausgeschaltetem Bildschirm pünktlich, das kostet aber etwas mehr Akku.',
      'Unter „Berechtigungen“ die Akku-Optimierung ausschalten.',
      'Die Daueranzeige kann man in den Benachrichtigungseinstellungen unter „Hintergrunddienst“ stumm schalten, aber nicht entfernen – Android verlangt sie für Hintergrunddienste.',
    ],
    restricted: [
      'Ab Android 13 sperrt Android die Bedienungshilfe und den Benachrichtigungszugriff für Apps, die nicht aus einem App-Store stammen. Der Schalter ist dann ausgegraut.',
      'Zuerst einmal versuchen, die Einstellung einzuschalten (die Meldung „Eingeschränkte Einstellung“ erscheint).',
      `Dann: ${APP} → oben rechts Menü (⋮) → „Eingeschränkte Einstellungen zulassen“ → mit PIN/Fingerabdruck bestätigen.`,
      'Danach die Bedienungshilfe bzw. den Benachrichtigungszugriff erneut einschalten.',
    ],
    vendors: [
      ['Samsung', 'Einstellungen → Akku → Hintergrundnutzungslimits → „Nie in Standby versetzte Apps“ → Makro Studio hinzufügen. Außerdem „Nicht verwendete Apps in Standby versetzen“ ausschalten.'],
      ['Xiaomi / Redmi / POCO', `${APP} → „Autostart“ einschalten; „Energiesparen“ → „Keine Einschränkungen“. In der App-Übersicht die App nach unten ziehen, um sie zu sperren (Schloss-Symbol).`],
      ['Huawei / Honor', 'Einstellungen → Akku → App-Start → Makro Studio → „Manuell verwalten“ → alle drei Schalter (Autostart, Sekundärstart, Im Hintergrund ausführen) einschalten.'],
      ['OnePlus / OPPO / realme', `${APP} → Akkunutzung → „Hintergrundaktivität zulassen“ und „Automatischen Start zulassen“ einschalten.`],
      ['Google Pixel / Motorola / Nokia', 'Meist genügt es, die Akku-Optimierung auszuschalten.'],
    ],
    limits: [
      'WLAN, mobile Daten, Bluetooth oder Flugmodus dürfen normale Apps seit Android 10 nicht mehr selbst schalten.',
      'SMS lesen und Anrufe erkennen ist Apps außerhalb des Play Stores praktisch nicht erlaubt und daher nicht enthalten.',
      'Wird Makro Studio in der App-Übersicht weggewischt, läuft der Hintergrunddienst weiter. Über „Beenden erzwingen“ wird er gestoppt, bis die App wieder geöffnet wird.',
    ],
  };
})();
