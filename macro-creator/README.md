# Makro Studio

Ein Makro-Ersteller im Stil von **MacroDroid**, der komplett im Browser läuft (installierbar als App/PWA, auch offline).
Ein Makro besteht wie bei MacroDroid aus **Auslösern**, **Aktionen** und **Bedingungen**.

## Starten

Die App braucht keinen Build-Schritt. Einfach den Ordner über einen Webserver ausliefern:

```bash
cd macro-creator
npx http-server -p 8080    # oder: python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Auf dem Handy über „Zum Startbildschirm hinzufügen“ bzw. „App installieren“
als eigenständige App nutzen. (Die `index.html` kann auch direkt per Doppelklick geöffnet werden – dann ohne Offline-Modus.)

## Android-App (APK)

Bei jedem Push baut GitHub Actions automatisch eine APK und veröffentlicht sie im Release
**„apk-latest“** (Repo → Releases). Auf dem Handy `MakroStudio.apk` herunterladen, öffnen und die Installation aus
dieser Quelle erlauben. Neue Versionen lassen sich direkt über die alte installieren; die Makros bleiben erhalten.

In der APK laufen Benachrichtigungen, Sprachausgabe, Taschenlampe, Vibration, Akku-Auslöser, Teilen, Datei-Export
und die Zurück-Taste über native Android-Funktionen (`android/`, Brücke in `js/native.js`). Die Zurück-Taste auf der
Startseite schickt die App in den Hintergrund, damit Makros weiterlaufen; Android kann sie dort nach einiger Zeit beenden.

Selbst bauen (Android Studio oder Android SDK nötig): `cd macro-creator/android && ./gradlew assembleRelease`.
Die APK ist mit dem Schlüssel `android/app/makrostudio.keystore` signiert, der bewusst im Repo liegt, damit Updates
über die bestehende Installation gehen. Für eine Veröffentlichung im Play Store einen eigenen, geheimen Schlüssel verwenden.

## Auf dem Handy mit HTTPS

Benachrichtigungen, Standort, Taschenlampe, Offline-Modus und „App installieren“ funktionieren im Browser nur über
HTTPS. Dafür gibt es einen eigenen Server mit lokalem Zertifikat (Node.js nötig, Rechner und Handy im selben WLAN):

```bash
cd macro-creator
npm install
npm run https
```

1. Am Handy die angezeigte Einrichtungsseite öffnen (`http://<IP-des-Rechners>:8080`) und **„Zertifikat herunterladen“** tippen.
2. Zertifikat installieren:
   - **Android:** Einstellungen → Sicherheit → Weitere Sicherheitseinstellungen → Verschlüsselung & Anmeldedaten →
     Zertifikat installieren → **CA-Zertifikat** → `makro-studio-ca.crt` wählen. Danach Chrome neu starten.
   - **iPhone:** Link in Safari öffnen → Einstellungen → „Profil geladen“ → Installieren → Allgemein → Info →
     Zertifikatsvertrauenseinstellungen → „Makro Studio lokale CA“ aktivieren.
3. `https://<IP-des-Rechners>:8443` öffnen und über das Browser-Menü als App installieren.

Das Zertifikat wird bei jedem Start für die aktuelle WLAN-Adresse neu ausgestellt. Die Zertifizierungsstelle wird
nur einmal erzeugt und liegt in `macro-creator/.certs/`. Der Schlüssel `ca.key` darf nicht weitergegeben werden.
Wenn du die Einrichtung nicht mehr brauchst, entferne das Zertifikat wieder vom Handy und lösche den Ordner `.certs/`.
Fragt die Firewall beim Start nach, den Zugriff im privaten Netzwerk erlauben. Ports lassen sich mit
`HTTPS_PORT=… SETUP_PORT=… npm run https` ändern.

## Funktionen

| Bereich | Inhalt |
| --- | --- |
| **Auslöser** | Tageszeit (mit Wochentagen), Regelmäßiges Intervall, Sonnenaufgang/-untergang, Tag im Monat, Akkustand, Stromanschluss, Netzwerkverbindung, App gestartet, App sichtbar/verborgen, Bildschirmausrichtung, Gerät schütteln, Gerät umdrehen, Geofence (Ort betreten/verlassen), Widget-Button, Verknüpfung (URL), Variable geändert, Leerer Auslöser |
| **Aktionen** | Benachrichtigung, Popup-Nachricht (Toast), Dialog, Bildschirm blinken, Text sprechen, Ton abspielen, Vibrieren, Taschenlampe, Bildschirm wach halten, Vollbild, Zwischenablage, Teilen, Website öffnen, Anrufen, SMS, E-Mail, Navigation, HTTP-Anfrage, Standort abrufen, Texteingabe-/Auswahl-/Bestätigungsdialog, Variable setzen (inkl. Rechnen, Zufall, Umschalten), Text bearbeiten, **Wenn / Sonst wenn / Sonst**, **Schleifen** (Anzahl, Solange, Endlos) mit Abbrechen/Weiter, Warten, Warten bis Bedingung, Makro ausführen, Makro (de)aktivieren, Makroaktionen abbrechen, Action Block, Protokolleintrag, Kommentar, Makro Studio an/aus |
| **Bedingungen** | Zeitraum, Wochentag, Tag im Monat, Monat, Akkustand, Ladestatus, Netzwerk, Ausrichtung, App im Vordergrund, Dunkles Design, Ort, Variablenwert, Makro aktiviert, Makro läuft – jeweils umkehrbar (NICHT) und mit UND/ODER verknüpfbar |
| **Variablen** | Globale und lokale Variablen (Boolesch, Ganzzahl, Dezimalzahl, Zeichenkette) |
| **Magic Text** | `{time}`, `{date}`, `{weekday}`, `{battery}`, `{v=name}`, `{lv=name}`, `{trigger_info}`, `{iteration}`, `{random=1-6}` … über den `{ }`-Knopf neben Textfeldern |
| **Action Blocks** | Wiederverwendbare Aktionsfolgen mit Ein- und Ausgabevariablen |
| **Weiteres** | 14 Vorlagen, Kategorien, Systemprotokoll mit Filtern, Import/Export als JSON, Testen einzelner Aktionen, helles/dunkles Design |

## Grenzen gegenüber MacroDroid

Makro Studio ist eine Web-App. Auslöser funktionieren, solange die App geöffnet ist (Tipp: als App installieren und
„Bildschirm wach halten“ aktivieren). Funktionen, die ein Browser grundsätzlich nicht darf – WLAN/Bluetooth schalten,
andere Apps beobachten, SMS lesen, Systemeinstellungen ändern – sind daher nicht enthalten. Einige Funktionen
(Akku, Vibration, Taschenlampe) hängen vom Browser ab und sind im Katalog entsprechend markiert.

## Aufbau

```
index.html          App-Gerüst
css/style.css       Design (hell/dunkel)
js/core.js          Speicher, Ereignisbus, Variablen, Magic Text, Rechner, Gerätezustand
js/catalog.js       Alle Auslöser, Aktionen und Bedingungen
js/engine.js        Ausführung inkl. Wenn/Sonst/Schleifen
js/ui.js            Dialoge, Auswahllisten, Formulare
js/templates.js     Vorlagen
js/views.js         Ansichten (Start, Makros, Editor, …)
js/app.js           Router und Start
sw.js               Offline-Cache und Benachrichtigungsklicks
```

Alle Daten werden lokal im Browser (`localStorage`) gespeichert. Schriften und Symbole liegen in `fonts/`, die App
braucht also kein Internet (außer für die Aktion „HTTP-Anfrage“).
