package de.d4rroy.makrostudio;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/**
 * Android-Funktionen für die Web-App (window.MakroAndroid). Die Methoden laufen auf
 * dem JavaBridge-Thread; alles, was die Oberfläche berührt, wird auf den
 * Hauptthread verlagert. Asynchrone Ergebnisse gehen über MS.native._resolve zurück.
 */
class NativeBridge {
    private static final String CHANNEL_ID = "macros";

    private final EngineHost host;
    private final Context app;

    private TextToSpeech tts;
    private boolean ttsReady;
    private final List<Runnable> ttsQueue = new ArrayList<>();

    private volatile boolean torchOn;
    private volatile boolean fullscreen;
    private String pendingSave;
    private final Map<Integer, String[]> permissionRequests = new HashMap<>();
    private int nextRequest = 100;
    private int nextNotification = 1;
    private android.os.PowerManager.WakeLock busyLock;

    NativeBridge(EngineHost host) {
        this.host = host;
        this.app = host.app;
        createNotificationChannel();
        CameraManager cm = (CameraManager) app.getSystemService(Context.CAMERA_SERVICE);
        if (cm != null) {
            cm.registerTorchCallback(new CameraManager.TorchCallback() {
                @Override
                public void onTorchModeChanged(String cameraId, boolean enabled) {
                    torchOn = enabled;
                }
            }, host.main);
        }
    }

    // ------------------------------------------------------------ Hilfen
    private void resolve(String id, String jsValue) {
        if (id == null || id.isEmpty()) return;
        host.eval("window.MS&&MS.native&&MS.native._resolve(" + JSONObject.quote(id) + "," + jsValue + ")");
    }

    private void toast(String message) {
        host.eval("window.MS&&MS.ui&&MS.ui.toast(" + JSONObject.quote(message) + ")");
    }

    /** Führt Code auf dem Hauptthread aus und wartet auf das Ergebnis. */
    private <T> T onMain(Callable<T> work, T fallback) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try {
                return work.call();
            } catch (Exception e) {
                return fallback;
            }
        }
        FutureTask<T> task = new FutureTask<>(work);
        host.main.post(task);
        try {
            return task.get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            return fallback;
        }
    }

    static String appLabel(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(ai).toString();
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
    }

    // --------------------------------------------------------------- Akku
    static int[] readBattery(Intent intent) {
        if (intent == null) return new int[] { -1, 0 };
        int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        int plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        int percent = level < 0 || scale <= 0 ? -1 : Math.round(level * 100f / scale);
        return new int[] { percent, plugged != 0 ? 1 : 0 };
    }

    @JavascriptInterface
    public String battery() {
        int[] b = readBattery(app.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)));
        return "{\"level\":" + b[0] + ",\"charging\":" + (b[1] == 1) + "}";
    }

    // ---------------------------------------------------- Benachrichtigungen
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                app.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(app.getString(R.string.channel_description));
        app.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return NotificationManagerCompat.from(app).areNotificationsEnabled();
    }

    @JavascriptInterface
    public boolean showNotification(String title, String text) {
        if (!notificationsAllowed()) return false;
        Intent open = new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(app, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(app, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFF2F7DE1)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(app).notify(nextNotification++, b.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }

    // ---------------------------------------------------- Berechtigungen
    private boolean granted(String permission) {
        return app.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** Status aller Berechtigungen und Hintergrund-Einstellungen als JSON. */
    @JavascriptInterface
    public String permissions() {
        try {
            NotificationManager nm = app.getSystemService(NotificationManager.class);
            PowerManager pm = app.getSystemService(PowerManager.class);
            JSONObject o = new JSONObject()
                    .put("notifications", notificationsAllowed())
                    .put("location", host.hasLocationPermission())
                    .put("background_location", Build.VERSION.SDK_INT < 29 ? host.hasLocationPermission() : granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                    .put("battery", pm.isIgnoringBatteryOptimizations(app.getPackageName()))
                    .put("accessibility", AccessibilityHelper.isEnabled(app))
                    .put("notification_listener", NotificationManagerCompat.getEnabledListenerPackages(app).contains(app.getPackageName()))
                    .put("dnd", nm.isNotificationPolicyAccessGranted())
                    .put("write_settings", Settings.System.canWrite(app))
                    .put("overlay", Settings.canDrawOverlays(app))
                    .put("bluetooth", Build.VERSION.SDK_INT < 31 || granted(Manifest.permission.BLUETOOTH_CONNECT))
                    .put("exact_alarm", WakeReceiver.canExact(app))
                    .put("phone", granted(Manifest.permission.READ_PHONE_STATE) && granted(Manifest.permission.CALL_PHONE)
                            && (Build.VERSION.SDK_INT < 26 || granted(Manifest.permission.ANSWER_PHONE_CALLS)) && granted(Manifest.permission.READ_CALL_LOG))
                    .put("sms", granted(Manifest.permission.RECEIVE_SMS) && granted(Manifest.permission.SEND_SMS))
                    .put("calendar", granted(Manifest.permission.READ_CALENDAR) && granted(Manifest.permission.WRITE_CALENDAR))
                    .put("service", MacroService.running)
                    .put(Prefs.AUTOSTART, Prefs.get(app).getBoolean(Prefs.AUTOSTART, false))
                    .put(Prefs.CPU_WAKE, Prefs.get(app).getBoolean(Prefs.CPU_WAKE, false))
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("manufacturer", Build.MANUFACTURER);
            return o.toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    /** Fragt eine Berechtigung ab oder öffnet die passende Android-Einstellungsseite. */
    @JavascriptInterface
    public void requestPermission(String which, String callbackId) {
        String pkg = app.getPackageName();
        Uri pkgUri = Uri.parse("package:" + pkg);
        String[] runtime = null;
        Intent settings = null;
        switch (which) {
            case "notifications":
                if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) runtime = new String[] { Manifest.permission.POST_NOTIFICATIONS };
                else settings = notificationSettings();
                break;
            case "location":
                runtime = new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION };
                break;
            case "background_location":
                if (!host.hasLocationPermission()) {
                    toast("Bitte zuerst „Standort“ erlauben");
                    resolve(callbackId, "false");
                    return;
                }
                if (Build.VERSION.SDK_INT >= 29) runtime = new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION };
                break;
            case "battery":
                settings = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri);
                break;
            case "exact_alarm":
                if (Build.VERSION.SDK_INT >= 31) settings = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkgUri);
                break;
            case "bluetooth":
                if (Build.VERSION.SDK_INT >= 31) runtime = new String[] { Manifest.permission.BLUETOOTH_CONNECT };
                break;
            case "phone": {
                List<String> p = new ArrayList<>(java.util.Arrays.asList(Manifest.permission.READ_PHONE_STATE, Manifest.permission.CALL_PHONE, Manifest.permission.READ_CALL_LOG));
                if (Build.VERSION.SDK_INT >= 26) p.add(Manifest.permission.ANSWER_PHONE_CALLS);
                runtime = p.toArray(new String[0]);
                break;
            }
            case "sms":
                runtime = new String[] { Manifest.permission.RECEIVE_SMS, Manifest.permission.SEND_SMS };
                break;
            case "calendar":
                runtime = new String[] { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR };
                break;
            case "accessibility":
                settings = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                break;
            case "notification_listener":
                settings = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                break;
            case "dnd":
                settings = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
                break;
            case "write_settings":
                settings = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, pkgUri);
                break;
            case "overlay":
                settings = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkgUri);
                break;
            case "app_info":
                settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri);
                break;
            default:
                break;
        }
        if (runtime != null) {
            Activity a = host.activity();
            if (a == null) {
                resolve(callbackId, "false");
                return;
            }
            int code;
            synchronized (this) {
                code = nextRequest++;
                permissionRequests.put(code, new String[] { callbackId, which });
            }
            String[] perms = runtime;
            host.main.post(() -> a.requestPermissions(perms, code));
            return;
        }
        if (settings != null) {
            Intent s = settings;
            boolean ok = onMain(() -> host.startActivity(s) || host.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri)), false);
            resolve(callbackId, String.valueOf(ok));
            return;
        }
        resolve(callbackId, "false");
    }

    private Intent notificationSettings() {
        return Build.VERSION.SDK_INT >= 26
                ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app.getPackageName())
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + app.getPackageName()));
    }

    void onPermissionResult(int code, boolean granted) {
        String[] req;
        synchronized (this) {
            req = permissionRequests.remove(code);
        }
        if (req == null) return;
        // Nach zweimaliger Ablehnung fragt Android nicht mehr – dann die App-Einstellungen öffnen
        if (!granted) {
            Intent s = "notifications".equals(req[1]) ? notificationSettings()
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + app.getPackageName()));
            host.main.post(() -> host.startActivity(s));
        }
        resolve(req[0], String.valueOf(granted));
    }

    // ---------------------------------------------------- Hintergrundbetrieb
    /** Schaltet Hintergrunddienst, Autostart oder „CPU wach halten“. */
    @JavascriptInterface
    public void setBackground(String key, boolean on) {
        Prefs.get(app).edit().putBoolean(key, on).apply();
        if (Prefs.SERVICE.equals(key)) {
            host.main.post(() -> {
                if (on) MacroService.start(app);
                else MacroService.stop(app);
            });
        } else if (Prefs.CPU_WAKE.equals(key)) {
            host.main.post(MacroService::updateWakeLock);
        }
    }

    @JavascriptInterface
    public void serviceStatus(String text, String title) {
        host.main.post(() -> MacroService.setStatus(text, title));
    }

    /** true genau einmal, wenn die Engine durch den Gerätestart gestartet wurde. */
    @JavascriptInterface
    public boolean startedByBoot() {
        boolean b = host.startedByBoot;
        host.startedByBoot = false;
        return b;
    }

    // --------------------------------------------------------- Vibration
    @JavascriptInterface
    public boolean vibrate(String pattern) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm == null ? null : vm.getDefaultVibrator();
        } else {
            v = (Vibrator) app.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (v == null || !v.hasVibrator()) return false;
        String[] parts = pattern.split(",");
        long[] timings = new long[parts.length + 1]; // beginnt mit 0 ms Pause
        for (int i = 0; i < parts.length; i++) {
            try {
                timings[i + 1] = Math.max(0, Long.parseLong(parts[i].trim()));
            } catch (NumberFormatException e) {
                timings[i + 1] = 0;
            }
        }
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(timings, -1));
        else v.vibrate(timings, -1);
        return true;
    }

    // ------------------------------------------------------ Sprachausgabe
    @JavascriptInterface
    public void speak(String text, String lang, double rate, double pitch, String callbackId) {
        host.main.post(() -> {
            Runnable job = () -> {
                tts.setLanguage(Locale.forLanguageTag(lang));
                tts.setSpeechRate((float) rate);
                tts.setPitch((float) pitch);
                String id = callbackId.isEmpty() ? "u" + System.nanoTime() : callbackId;
                if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) resolve(callbackId, "false");
            };
            if (tts == null) {
                tts = new TextToSpeech(app, status -> {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (!ttsReady) toast("Sprachausgabe nicht verfügbar");
                    for (Runnable r : ttsQueue) r.run();
                    ttsQueue.clear();
                });
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { resolve(id, "true"); }
                    @Override public void onError(String id) { resolve(id, "false"); }
                    @Override public void onStop(String id, boolean interrupted) { resolve(id, "false"); }
                });
                ttsQueue.add(job);
            } else if (ttsReady) {
                job.run();
            } else {
                ttsQueue.add(job);
            }
        });
    }

    @JavascriptInterface
    public void stopSpeaking() {
        host.main.post(() -> {
            if (tts != null) tts.stop();
        });
    }

    // ------------------------------------------------------ Taschenlampe
    @JavascriptInterface
    public String torch(boolean on) {
        CameraManager cm = (CameraManager) app.getSystemService(Context.CAMERA_SERVICE);
        if (cm == null) return "Kamera nicht verfügbar";
        try {
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics c = cm.getCameraCharacteristics(id);
                Boolean flash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = c.get(CameraCharacteristics.LENS_FACING);
                if (Boolean.TRUE.equals(flash) && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cm.setTorchMode(id, on);
                    torchOn = on;
                    return "";
                }
            }
            return "Dieses Gerät hat keine Taschenlampe";
        } catch (Exception e) {
            return "Taschenlampe: " + e.getMessage();
        }
    }

    @JavascriptInterface
    public boolean isTorchOn() {
        return torchOn;
    }

    // ---------------------------------------------------------- Bildschirm
    @JavascriptInterface
    public void keepScreenOn(boolean on) {
        host.main.post(() -> {
            Activity a = host.activity();
            if (a == null) return;
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @JavascriptInterface
    public void fullscreen(boolean on) {
        fullscreen = on;
        host.main.post(() -> {
            Activity a = host.activity();
            if (a == null) return;
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView());
            if (on) {
                c.hide(WindowInsetsCompat.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
        });
    }

    @JavascriptInterface
    public boolean isFullscreen() {
        return fullscreen;
    }

    @JavascriptInterface
    public String setBrightness(int percent, boolean auto) {
        if (!Settings.System.canWrite(app)) return "Berechtigung „Systemeinstellungen ändern“ fehlt";
        try {
            Settings.System.putInt(app.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE,
                    auto ? Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            if (!auto) {
                int value = Math.max(1, Math.min(255, Math.round(Math.max(0, Math.min(100, percent)) * 2.55f)));
                Settings.System.putInt(app.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, value);
            }
            return "";
        } catch (Exception e) {
            return "Helligkeit: " + e.getMessage();
        }
    }

    // ------------------------------------------------------- Ton & Modus
    private static int stream(String name) {
        switch (name) {
            case "ring": return AudioManager.STREAM_RING;
            case "alarm": return AudioManager.STREAM_ALARM;
            case "notification": return AudioManager.STREAM_NOTIFICATION;
            case "call": return AudioManager.STREAM_VOICE_CALL;
            case "system": return AudioManager.STREAM_SYSTEM;
            default: return AudioManager.STREAM_MUSIC;
        }
    }

    @JavascriptInterface
    public String setVolume(String name, int percent) {
        AudioManager am = app.getSystemService(AudioManager.class);
        int s = stream(name);
        int max = am.getStreamMaxVolume(s);
        try {
            am.setStreamVolume(s, Math.round(max * Math.max(0, Math.min(100, percent)) / 100f), 0);
            return "";
        } catch (SecurityException e) {
            return "Für diese Änderung wird der „Bitte nicht stören“-Zugriff benötigt";
        }
    }

    @JavascriptInterface
    public int getVolume(String name) {
        AudioManager am = app.getSystemService(AudioManager.class);
        int s = stream(name);
        int max = am.getStreamMaxVolume(s);
        return max == 0 ? 0 : Math.round(am.getStreamVolume(s) * 100f / max);
    }

    @JavascriptInterface
    public String setRingerMode(String mode) {
        AudioManager am = app.getSystemService(AudioManager.class);
        int m = "silent".equals(mode) ? AudioManager.RINGER_MODE_SILENT
                : "vibrate".equals(mode) ? AudioManager.RINGER_MODE_VIBRATE : AudioManager.RINGER_MODE_NORMAL;
        try {
            am.setRingerMode(m);
            return "";
        } catch (SecurityException e) {
            return "Für „Lautlos“ wird der „Bitte nicht stören“-Zugriff benötigt";
        }
    }

    @JavascriptInterface
    public String getRingerMode() {
        int m = app.getSystemService(AudioManager.class).getRingerMode();
        return m == AudioManager.RINGER_MODE_SILENT ? "silent" : m == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : "normal";
    }

    @JavascriptInterface
    public String setDnd(String mode) {
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        if (!nm.isNotificationPolicyAccessGranted()) return "„Bitte nicht stören“-Zugriff fehlt";
        int f;
        switch (mode) {
            case "priority": f = NotificationManager.INTERRUPTION_FILTER_PRIORITY; break;
            case "alarms": f = NotificationManager.INTERRUPTION_FILTER_ALARMS; break;
            case "none": f = NotificationManager.INTERRUPTION_FILTER_NONE; break;
            default: f = NotificationManager.INTERRUPTION_FILTER_ALL; break;
        }
        nm.setInterruptionFilter(f);
        return "";
    }

    /** Medientaste senden: play, pause, play_pause, next, previous, stop. */
    @JavascriptInterface
    public String mediaControl(String action) {
        int key;
        switch (action) {
            case "play": key = android.view.KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pause": key = android.view.KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            case "next": key = android.view.KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": key = android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            case "stop": key = android.view.KeyEvent.KEYCODE_MEDIA_STOP; break;
            default: key = android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; break;
        }
        AudioManager am = app.getSystemService(AudioManager.class);
        am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, key));
        am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, key));
        return "";
    }

    @JavascriptInterface
    public boolean isMusicActive() {
        return app.getSystemService(AudioManager.class).isMusicActive();
    }

    @JavascriptInterface
    public boolean isDndOn() {
        return app.getSystemService(NotificationManager.class).getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL;
    }

    // ---------------------------------------------------------------- Apps
    /** Alle Apps mit Startsymbol als JSON-Liste [{pkg, label}]. */
    @JavascriptInterface
    public String apps() {
        PackageManager pm = app.getPackageManager();
        List<ResolveInfo> list = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0);
        List<String[]> entries = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo ri : list) {
            String pkg = ri.activityInfo.packageName;
            if (seen.add(pkg)) entries.add(new String[] { pkg, ri.loadLabel(pm).toString() });
        }
        entries.sort((a, b) -> a[1].compareToIgnoreCase(b[1]));
        JSONArray arr = new JSONArray();
        try {
            for (String[] e : entries) arr.put(new JSONObject().put("pkg", e[0]).put("label", e[1]));
        } catch (JSONException ignored) {
            // nicht erreichbar
        }
        return arr.toString();
    }

    @JavascriptInterface
    public String launchApp(String pkg) {
        Intent i = app.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) return "App nicht gefunden: " + pkg;
        return onMain(() -> host.startActivity(i) ? "" : "App konnte nicht geöffnet werden", "App konnte nicht geöffnet werden");
    }

    // ------------------------------------------------- UI-Interaktion
    @JavascriptInterface
    public String uiClick(String mode, String query, String match, boolean longPress, double x, double y, boolean percent) {
        return onMain(() -> AccessibilityHelper.click(mode, query, match, longPress, (float) x, (float) y, percent), "UI-Interaktion fehlgeschlagen");
    }

    @JavascriptInterface
    public String uiSwipe(double x1, double y1, double x2, double y2, int durationMs, boolean percent) {
        return onMain(() -> AccessibilityHelper.swipe((float) x1, (float) y1, (float) x2, (float) y2, durationMs, percent), "Wischen fehlgeschlagen");
    }

    @JavascriptInterface
    public String uiSetText(String text) {
        return onMain(() -> AccessibilityHelper.setText(text), "Texteingabe fehlgeschlagen");
    }

    @JavascriptInterface
    public boolean screenContains(String query, String match) {
        return onMain(() -> AccessibilityHelper.screenContains(query, match), false);
    }

    /** Läuft absichtlich auf dem JavaBridge-Thread, weil zwischen den Schritten gewartet wird. */
    @JavascriptInterface
    public String pinUnlock(String pin, boolean pressEnter, int digitDelay, int swipeDelay) {
        return AccessibilityHelper.pinUnlock(pin, pressEnter, digitDelay, swipeDelay);
    }

    @JavascriptInterface
    public String wakeScreen() {
        return AccessibilityHelper.wakeScreen(app);
    }

    @JavascriptInterface
    public String foregroundActivity() {
        return AccessibilityHelper.currentActivity;
    }

    @JavascriptInterface
    public String foregroundAppName() {
        String pkg = AccessibilityHelper.currentPackage;
        return pkg.isEmpty() ? "" : appLabel(app, pkg);
    }

    // ------------------------------------------------- Bild auf dem Bildschirm
    private java.io.File imageDir() {
        java.io.File d = new java.io.File(app.getFilesDir(), "images");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private String pendingImageCallback;

    /** Lässt ein Vergleichsbild auswählen und speichert eine Kopie in der App. Ergebnis: Dateiname oder "". */
    @JavascriptInterface
    public void pickImage(String callbackId) {
        host.main.post(() -> {
            Activity a = host.activity();
            if (a == null) {
                resolve(callbackId, "\"\"");
                return;
            }
            pendingImageCallback = callbackId;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
            try {
                a.startActivityForResult(i, EngineHost.REQ_IMAGE);
            } catch (Exception e) {
                pendingImageCallback = null;
                resolve(callbackId, "\"\"");
            }
        });
    }

    void onImagePicked(Uri uri) {
        String cb = pendingImageCallback;
        pendingImageCallback = null;
        if (cb == null) return;
        if (uri == null) {
            resolve(cb, "\"\"");
            return;
        }
        String name = "img_" + System.currentTimeMillis() + ".png";
        try (java.io.InputStream in = app.getContentResolver().openInputStream(uri)) {
            android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeStream(in);
            if (bmp == null) throw new java.io.IOException("Kein Bild");
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(imageDir(), name))) {
                bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
            }
            resolve(cb, JSONObject.quote(name));
        } catch (Exception e) {
            toast("Bild konnte nicht geladen werden: " + e.getMessage());
            resolve(cb, "\"\"");
        }
    }

    /** Kleine Vorschau eines gespeicherten Vergleichsbilds als data:-URL (für den Editor). */
    @JavascriptInterface
    public String imagePreview(String name) {
        java.io.File f = new java.io.File(imageDir(), new java.io.File(name).getName());
        android.graphics.Bitmap b = android.graphics.BitmapFactory.decodeFile(f.getPath());
        if (b == null) return "";
        float scale = Math.min(1f, 240f / Math.max(b.getWidth(), b.getHeight()));
        android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * scale)), Math.max(1, Math.round(b.getHeight() * scale)), true);
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        small.compress(android.graphics.Bitmap.CompressFormat.PNG, 90, bos);
        return "data:image/png;base64," + android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP)
                + "#" + b.getWidth() + "x" + b.getHeight();
    }

    /**
     * Sucht das Vergleichsbild auf dem Bildschirm. region: "x,y,w,h" in Pixeln oder leer.
     * Ergebnis (JSON): {found, centerX, centerY, startX, startY, endX, endY, matchPercent} oder {error}.
     */
    @JavascriptInterface
    public void findImage(String name, String region, double threshold, String callbackId) {
        java.io.File f = new java.io.File(imageDir(), new java.io.File(name).getName());
        android.graphics.Bitmap template = android.graphics.BitmapFactory.decodeFile(f.getPath());
        if (template == null) {
            resolve(callbackId, JSONObject.quote("{\"error\":\"Kein Vergleichsbild ausgewählt\"}"));
            return;
        }
        String err = onMain(() -> AccessibilityHelper.screenshot((screen) -> {
            if (screen == null) {
                resolve(callbackId, JSONObject.quote("{\"error\":" + JSONObject.quote(AccessibilityHelper.lastScreenshotError.isEmpty() ? "Screenshot nicht möglich" : AccessibilityHelper.lastScreenshotError) + "}"));
                return;
            }
            new Thread(() -> {
                int[] r = null;
                if (!region.isEmpty()) {
                    String[] p = region.split(",");
                    r = new int[] { Integer.parseInt(p[0].trim()), Integer.parseInt(p[1].trim()), Integer.parseInt(p[2].trim()), Integer.parseInt(p[3].trim()) };
                }
                ImageMatcher.Result m = ImageMatcher.find(screen, template, r, threshold);
                try {
                    JSONObject o = new JSONObject()
                            .put("found", m.found)
                            .put("centerX", (m.startX + m.endX) / 2).put("centerY", (m.startY + m.endY) / 2)
                            .put("startX", m.startX).put("startY", m.startY).put("endX", m.endX).put("endY", m.endY)
                            .put("matchPercent", Math.round(Math.max(0, m.score) * 100))
                            .put("screenWidth", screen.getWidth()).put("screenHeight", screen.getHeight());
                    resolve(callbackId, JSONObject.quote(o.toString()));
                } catch (JSONException e) {
                    resolve(callbackId, JSONObject.quote("{\"error\":\"Auswertung fehlgeschlagen\"}"));
                }
            }).start();
        }), "Screenshot fehlgeschlagen (Bedienungshilfe antwortet nicht)");
        if (err != null && !err.isEmpty()) resolve(callbackId, JSONObject.quote("{\"error\":" + JSONObject.quote(err) + "}"));
    }

    @JavascriptInterface
    public boolean isDeviceLocked() {
        android.app.KeyguardManager km = app.getSystemService(android.app.KeyguardManager.class);
        return km.isKeyguardLocked();
    }

    /** Sendet einen Android-Intent. target: activity | broadcast | service; extras als JSON-Objekt. */
    @JavascriptInterface
    public String sendIntent(String target, String action, String data, String mime, String pkg, String cls, String category, int flags, String extrasJson) {
        try {
            Intent i = new Intent();
            if (!action.isEmpty()) i.setAction(action);
            if (!category.isEmpty()) i.addCategory(category);
            if (flags != 0) i.addFlags(flags);
            if (!data.isEmpty() && !mime.isEmpty()) i.setDataAndType(Uri.parse(data), mime);
            else if (!data.isEmpty()) i.setData(Uri.parse(data));
            else if (!mime.isEmpty()) i.setType(mime);
            if (!pkg.isEmpty() && !cls.isEmpty()) i.setClassName(pkg, cls.startsWith(".") ? pkg + cls : cls);
            else if (!pkg.isEmpty()) i.setPackage(pkg);
            JSONObject extras = new JSONObject(extrasJson.isEmpty() ? "{}" : extrasJson);
            for (java.util.Iterator<String> it = extras.keys(); it.hasNext();) {
                String k = it.next();
                Object v = extras.get(k);
                if (v instanceof Boolean) i.putExtra(k, (Boolean) v);
                else if (v instanceof Integer) i.putExtra(k, (Integer) v);
                else if (v instanceof Long) i.putExtra(k, (Long) v);
                else if (v instanceof Double) i.putExtra(k, (Double) v);
                else i.putExtra(k, String.valueOf(v));
            }
            switch (target) {
                case "broadcast":
                    app.sendBroadcast(i);
                    return "";
                case "service":
                    app.startService(i);
                    return "";
                default:
                    return onMain(() -> host.startActivity(i) ? "" : "Keine App für diesen Intent gefunden", "Intent fehlgeschlagen");
            }
        } catch (Exception e) {
            return "Intent: " + e.getMessage();
        }
    }

    @JavascriptInterface
    public String foregroundApp() {
        return AccessibilityHelper.currentPackage;
    }

    @JavascriptInterface
    public String systemAction(String action) {
        return onMain(() -> AccessibilityHelper.perform(action), "Systemaktion fehlgeschlagen");
    }

    // ------------------------------------------------- Zeitsteuerung
    /** Wartet ms Millisekunden über Android (nicht gedrosselt wie JavaScript-Timer). */
    @JavascriptInterface
    public void delay(double ms, String callbackId) {
        host.main.postDelayed(() -> resolve(callbackId, "true"), Math.max(0, Math.round(ms)));
    }

    /** Hält die CPU wach, solange ein Makro läuft (höchstens 30 Minuten am Stück). */
    @JavascriptInterface
    public void setBusy(boolean busy) {
        host.main.post(() -> {
            if (busy) {
                if (busyLock == null) {
                    busyLock = app.getSystemService(android.os.PowerManager.class)
                            .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "MakroStudio:busy");
                    busyLock.setReferenceCounted(false);
                }
                busyLock.acquire(30 * 60_000L);
            } else if (busyLock != null && busyLock.isHeld()) {
                busyLock.release();
            }
        });
    }

    /** Nächsten Weckzeitpunkt planen (Unix-Zeit in ms, 0 = keiner). */
    @JavascriptInterface
    public void scheduleWake(double at) {
        WakeReceiver.schedule(app, (long) at);
    }

    // ------------------------------------------------- Teilen & Öffnen
    @JavascriptInterface
    public void copy(String text) {
        host.main.post(() -> {
            ClipboardManager cm = (ClipboardManager) app.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Makro Studio", text));
        });
    }

    @JavascriptInterface
    public void share(String title, String text) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        host.main.post(() -> host.startActivity(Intent.createChooser(send, title.isEmpty() ? null : title)));
    }

    @JavascriptInterface
    public String openUrl(String url) {
        return openExternal(url);
    }

    /** Öffnet eine Adresse in der zuständigen App. Gibt "" oder eine Fehlermeldung zurück. */
    String openExternal(String url) {
        return onMain(() -> {
            try {
                Intent i = url.startsWith("intent:")
                        ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
                return host.startActivity(i) ? "" : "Keine App gefunden, die diese Adresse öffnen kann";
            } catch (Exception e) {
                return "Öffnen fehlgeschlagen: " + e.getMessage();
            }
        }, "Öffnen fehlgeschlagen");
    }

    // ---------------------------------------------------------- Dateien
    @JavascriptInterface
    public void saveFile(String name, String content) {
        host.main.post(() -> {
            Activity a = host.activity();
            if (a == null) return;
            pendingSave = content;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json")
                    .putExtra(Intent.EXTRA_TITLE, name);
            try {
                a.startActivityForResult(i, EngineHost.REQ_SAVE);
            } catch (Exception e) {
                pendingSave = null;
                toast("Kein Dateimanager zum Speichern gefunden");
            }
        });
    }

    void onSaveResult(Uri uri) {
        String content = pendingSave;
        pendingSave = null;
        if (uri == null || content == null) return;
        try (OutputStream os = app.getContentResolver().openOutputStream(uri)) {
            if (os == null) throw new java.io.IOException("Datei nicht beschreibbar");
            os.write(content.getBytes(StandardCharsets.UTF_8));
            toast("Datei gespeichert");
        } catch (Exception e) {
            toast("Speichern fehlgeschlagen: " + e.getMessage());
        }
    }

    // ====================================================== Systemereignisse
    /** Die Web-App ist bereit: liefert Ereignisse, die vorher eingetroffen sind. */
    @JavascriptInterface
    public String engineReady() {
        return host.engineReady();
    }

    /** Aktueller Gerätezustand für Bedingungen (Netzwerk, Kopfhörer, Bildschirm, Anruf …). */
    @JavascriptInterface
    public String deviceState() {
        try {
            SystemMonitor m = host.monitor();
            PowerManager pm = app.getSystemService(PowerManager.class);
            android.bluetooth.BluetoothManager bm = app.getSystemService(android.bluetooth.BluetoothManager.class);
            android.net.wifi.WifiManager wm = app.getSystemService(android.net.wifi.WifiManager.class);
            Intent bat = app.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            JSONObject o = new JSONObject()
                    .put("network", m == null ? new JSONObject() : m.currentNetwork())
                    .put("headphones", m != null && m.headphonesConnected())
                    .put("call", m == null ? "idle" : m.callState())
                    .put("screenOn", pm.isInteractive())
                    .put("powerSave", pm.isPowerSaveMode())
                    .put("airplane", Settings.Global.getInt(app.getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0) == 1)
                    .put("btOn", bm != null && bm.getAdapter() != null && bm.getAdapter().isEnabled())
                    .put("wifiOn", wm != null && wm.isWifiEnabled())
                    .put("batteryTemp", bat == null ? 0 : bat.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0);
            return o.toString();
        } catch (JSONException | RuntimeException e) {
            return "{}";
        }
    }

    /** Einstellungen, die Android-Komponenten ohne Web-App lesen (Lautstärketasten, Kacheln). */
    @JavascriptInterface
    public void setFlag(String key, boolean on) {
        if (!key.equals(Prefs.VOLUME_WATCH) && !key.equals(Prefs.VOLUME_CONSUME)) return;
        Prefs.get(app).edit().putBoolean(key, on).apply();
    }

    @JavascriptInterface
    public void setTileLabel(int tile, String label) {
        if (tile < 1 || tile > 3) return;
        Prefs.get(app).edit().putString("tile_label_" + tile, label).apply();
        if (Build.VERSION.SDK_INT >= 24) {
            Class<?> c = tile == 1 ? Tile1.class : tile == 2 ? Tile2.class : Tile3.class;
            android.service.quicksettings.TileService.requestListeningState(app, new android.content.ComponentName(app, c));
        }
    }

    /** Webhook-Server: port 0 = aus. */
    @JavascriptInterface
    public void setWebhook(int port, String token) {
        Prefs.get(app).edit().putInt(Prefs.WEBHOOK_PORT, port).putString(Prefs.WEBHOOK_TOKEN, token).apply();
        host.main.post(host::updateWebhook);
    }

    /** IP-Adressen des Geräts im lokalen Netz. */
    @JavascriptInterface
    public String localIps() {
        JSONArray a = new JSONArray();
        try {
            for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (java.net.InetAddress ad : java.util.Collections.list(ni.getInetAddresses())) {
                    if (ad instanceof java.net.Inet4Address) a.put(ad.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            // keine Netzwerkschnittstellen
        }
        return a.toString();
    }

    // ============================================================ Telefon
    @JavascriptInterface
    public String callNumber(String number) {
        if (!granted(Manifest.permission.CALL_PHONE)) return "Berechtigung „Telefon“ fehlt (Berechtigungen → Telefon)";
        Intent i = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number)));
        return onMain(() -> host.startActivity(i) ? "" : "Anruf konnte nicht gestartet werden", "Anruf fehlgeschlagen");
    }

    @SuppressWarnings({ "deprecation", "MissingPermission" })
    @JavascriptInterface
    public String callControl(String action) {
        if (Build.VERSION.SDK_INT < 26) return "Benötigt Android 8";
        if (!granted(Manifest.permission.ANSWER_PHONE_CALLS)) return "Berechtigung „Telefon“ fehlt (Berechtigungen → Telefon)";
        android.telecom.TelecomManager tm = app.getSystemService(android.telecom.TelecomManager.class);
        try {
            if ("answer".equals(action)) {
                tm.acceptRingingCall();
                return "";
            }
            if (Build.VERSION.SDK_INT < 28) return "Auflegen benötigt Android 9";
            return tm.endCall() ? "" : "Kein laufender Anruf";
        } catch (SecurityException e) {
            return "Anrufsteuerung verweigert: " + e.getMessage();
        }
    }

    @SuppressWarnings("deprecation")
    @JavascriptInterface
    public String sendSms(String number, String text) {
        if (!granted(Manifest.permission.SEND_SMS)) return "Berechtigung „SMS“ fehlt (Berechtigungen → SMS)";
        try {
            android.telephony.SmsManager sm = Build.VERSION.SDK_INT >= 31
                    ? app.getSystemService(android.telephony.SmsManager.class)
                    : android.telephony.SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(text);
            if (parts.size() > 1) sm.sendMultipartTextMessage(number, null, parts, null, null);
            else sm.sendTextMessage(number, null, text, null, null);
            return "";
        } catch (RuntimeException e) {
            return "SMS: " + e.getMessage();
        }
    }

    // ================================================= Benachrichtigungen anderer Apps
    @JavascriptInterface
    public String notificationDismiss(String pkg, String contains) {
        return NotificationWatcher.dismiss(pkg, contains);
    }

    @JavascriptInterface
    public String notificationPress(String pkg, String contains, String button) {
        return NotificationWatcher.press(pkg, contains, button);
    }

    // ================================================= Bildschirminhalt
    @JavascriptInterface
    public String screenText() {
        String t = onMain(AccessibilityHelper::screenText, null);
        try {
            return t == null ? new JSONObject().put("error", "Bedienungshilfe ist nicht aktiviert (Berechtigungen → Bedienungshilfe)").toString()
                    : new JSONObject().put("text", t).toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    /** Texterkennung (OCR) auf einem Screenshot. Ergebnis JSON {text} oder {error}. */
    @JavascriptInterface
    public void ocr(String region, String callbackId) {
        String err = onMain(() -> AccessibilityHelper.screenshot((screen) -> {
            if (screen == null) {
                resolve(callbackId, JSONObject.quote("{\"error\":" + JSONObject.quote(AccessibilityHelper.lastScreenshotError.isEmpty() ? "Screenshot nicht möglich" : AccessibilityHelper.lastScreenshotError) + "}"));
                return;
            }
            android.graphics.Bitmap img = screen;
            try {
                if (!region.isEmpty()) {
                    String[] p = region.split(",");
                    int x = Math.max(0, Integer.parseInt(p[0].trim())), y = Math.max(0, Integer.parseInt(p[1].trim()));
                    int w = Math.min(screen.getWidth() - x, Integer.parseInt(p[2].trim()));
                    int h = Math.min(screen.getHeight() - y, Integer.parseInt(p[3].trim()));
                    if (w > 0 && h > 0) img = android.graphics.Bitmap.createBitmap(screen, x, y, w, h);
                }
            } catch (RuntimeException e) {
                img = screen;
            }
            TextOcr.recognize(img, (text, error) -> {
                try {
                    JSONObject o = error != null ? new JSONObject().put("error", error) : new JSONObject().put("text", text);
                    resolve(callbackId, JSONObject.quote(o.toString()));
                } catch (JSONException e) {
                    resolve(callbackId, JSONObject.quote("{\"error\":\"OCR fehlgeschlagen\"}"));
                }
            });
        }), "Screenshot fehlgeschlagen (Bedienungshilfe antwortet nicht)");
        if (err != null && !err.isEmpty()) resolve(callbackId, JSONObject.quote("{\"error\":" + JSONObject.quote(err) + "}"));
    }

    // ============================================================ Dateien
    private String pendingFolderCallback;
    private String pendingSpeechCallback;

    /** Lässt einen Ordner auswählen (dauerhafte Freigabe). Ergebnis: URI oder "". */
    @JavascriptInterface
    public void pickFolder(String callbackId) {
        host.main.post(() -> {
            Activity a = host.activity();
            if (a == null) {
                resolve(callbackId, "\"\"");
                return;
            }
            pendingFolderCallback = callbackId;
            try {
                a.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), EngineHost.REQ_FOLDER);
            } catch (Exception e) {
                pendingFolderCallback = null;
                resolve(callbackId, "\"\"");
            }
        });
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == EngineHost.REQ_FOLDER) {
            String cb = pendingFolderCallback;
            pendingFolderCallback = null;
            if (cb == null) return;
            Uri uri = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) {
                resolve(cb, "\"\"");
                return;
            }
            try {
                app.getContentResolver().takePersistableUriPermission(uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // nicht dauerhaft freigegeben – gilt dann nur bis zum Neustart
            }
            resolve(cb, JSONObject.quote(uri.toString()));
        } else if (requestCode == EngineHost.REQ_SPEECH) {
            String cb = pendingSpeechCallback;
            pendingSpeechCallback = null;
            if (cb == null) return;
            ArrayList<String> res = resultCode == Activity.RESULT_OK && data != null
                    ? data.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS) : null;
            resolve(cb, JSONObject.quote(res == null || res.isEmpty() ? "" : res.get(0)));
        }
    }

    private static String readAll(java.io.InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            b.write(buf, 0, n);
            if (b.size() > 5 * 1024 * 1024) throw new java.io.IOException("Datei ist größer als 5 MB");
        }
        return b.toString("UTF-8");
    }

    /** Dateiaktion im freigegebenen Ordner. op: write | append | read | delete | exists | list. Ergebnis JSON {text} oder {error}. */
    @JavascriptInterface
    public String fileOp(String folder, String name, String op, String text) {
        try {
            if (folder.isEmpty()) return new JSONObject().put("error", "Kein Ordner ausgewählt").toString();
            androidx.documentfile.provider.DocumentFile dir = androidx.documentfile.provider.DocumentFile.fromTreeUri(app, Uri.parse(folder));
            if (dir == null || !dir.canRead()) return new JSONObject().put("error", "Ordner nicht zugänglich – bitte neu auswählen").toString();
            if ("list".equals(op)) {
                StringBuilder sb = new StringBuilder();
                for (androidx.documentfile.provider.DocumentFile f : dir.listFiles()) sb.append(f.getName()).append('\n');
                return new JSONObject().put("text", sb.toString().trim()).toString();
            }
            String clean = new java.io.File(name).getName();
            if (clean.isEmpty()) return new JSONObject().put("error", "Kein Dateiname").toString();
            androidx.documentfile.provider.DocumentFile f = dir.findFile(clean);
            switch (op) {
                case "exists":
                    return new JSONObject().put("text", f != null && f.exists() ? "true" : "false").toString();
                case "read":
                    if (f == null) return new JSONObject().put("error", "Datei „" + clean + "“ nicht gefunden").toString();
                    try (java.io.InputStream in = app.getContentResolver().openInputStream(f.getUri())) {
                        return new JSONObject().put("text", in == null ? "" : readAll(in)).toString();
                    }
                case "delete":
                    return new JSONObject().put("text", f != null && f.delete() ? "true" : "false").toString();
                default: {
                    boolean append = "append".equals(op);
                    if (f == null) f = dir.createFile("text/plain", clean);
                    if (f == null) return new JSONObject().put("error", "Datei konnte nicht angelegt werden").toString();
                    try (OutputStream os = app.getContentResolver().openOutputStream(f.getUri(), append ? "wa" : "wt")) {
                        if (os == null) throw new java.io.IOException("Datei nicht beschreibbar");
                        os.write(text.getBytes(StandardCharsets.UTF_8));
                    }
                    return new JSONObject().put("text", "").toString();
                }
            }
        } catch (Exception e) {
            return "{\"error\":" + JSONObject.quote("Datei: " + e.getMessage()) + "}";
        }
    }

    // ============================================================ E-Mail
    @JavascriptInterface
    public void sendMail(String json, String callbackId) {
        new Thread(() -> {
            String err;
            try {
                JSONObject o = new JSONObject(json);
                err = SmtpClient.send(o.getString("host"), o.getInt("port"), o.optString("security", "ssl"),
                        o.optString("user"), o.optString("password"), o.getString("from"), o.getString("to"),
                        o.optString("subject"), o.optString("body"));
            } catch (JSONException e) {
                err = "E-Mail: unvollständige Angaben";
            }
            resolve(callbackId, JSONObject.quote(err));
        }, "E-Mail").start();
    }

    // ============================================================ Kalender
    /** Termine zwischen from und to (ms) als JSON-Array. */
    @JavascriptInterface
    public String calendarEvents(double from, double to) {
        if (!granted(Manifest.permission.READ_CALENDAR)) return "{\"error\":\"Berechtigung „Kalender“ fehlt\"}";
        JSONArray a = new JSONArray();
        Uri.Builder b = android.provider.CalendarContract.Instances.CONTENT_URI.buildUpon();
        android.content.ContentUris.appendId(b, (long) from);
        android.content.ContentUris.appendId(b, (long) to);
        String[] cols = { android.provider.CalendarContract.Instances.TITLE, android.provider.CalendarContract.Instances.BEGIN,
                android.provider.CalendarContract.Instances.END, android.provider.CalendarContract.Instances.ALL_DAY,
                android.provider.CalendarContract.Instances.EVENT_LOCATION, android.provider.CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
                android.provider.CalendarContract.Instances.DESCRIPTION };
        try (android.database.Cursor c = app.getContentResolver().query(b.build(), cols, null, null,
                android.provider.CalendarContract.Instances.BEGIN + " ASC")) {
            while (c != null && c.moveToNext() && a.length() < 200) {
                a.put(new JSONObject().put("title", c.getString(0) == null ? "" : c.getString(0)).put("begin", c.getLong(1))
                        .put("end", c.getLong(2)).put("allDay", c.getInt(3) == 1)
                        .put("location", c.getString(4) == null ? "" : c.getString(4))
                        .put("calendar", c.getString(5) == null ? "" : c.getString(5))
                        .put("description", c.getString(6) == null ? "" : c.getString(6)));
            }
        } catch (Exception e) {
            return "{\"error\":" + JSONObject.quote("Kalender: " + e.getMessage()) + "}";
        }
        return a.toString();
    }

    @JavascriptInterface
    public String calendarAdd(String title, String description, String location, double begin, double end, boolean allDay) {
        if (!granted(Manifest.permission.WRITE_CALENDAR) || !granted(Manifest.permission.READ_CALENDAR)) return "Berechtigung „Kalender“ fehlt";
        long calId = -1;
        try (android.database.Cursor c = app.getContentResolver().query(android.provider.CalendarContract.Calendars.CONTENT_URI,
                new String[] { android.provider.CalendarContract.Calendars._ID, android.provider.CalendarContract.Calendars.IS_PRIMARY },
                android.provider.CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">=" + android.provider.CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR
                        + " AND " + android.provider.CalendarContract.Calendars.VISIBLE + "=1",
                null, null)) {
            while (c != null && c.moveToNext()) {
                if (calId < 0 || c.getInt(1) == 1) calId = c.getLong(0);
            }
        } catch (Exception e) {
            return "Kalender: " + e.getMessage();
        }
        if (calId < 0) return "Kein beschreibbarer Kalender gefunden";
        android.content.ContentValues v = new android.content.ContentValues();
        v.put(android.provider.CalendarContract.Events.CALENDAR_ID, calId);
        v.put(android.provider.CalendarContract.Events.TITLE, title);
        v.put(android.provider.CalendarContract.Events.DESCRIPTION, description);
        v.put(android.provider.CalendarContract.Events.EVENT_LOCATION, location);
        v.put(android.provider.CalendarContract.Events.DTSTART, (long) begin);
        v.put(android.provider.CalendarContract.Events.DTEND, (long) Math.max(begin, end));
        v.put(android.provider.CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
        v.put(android.provider.CalendarContract.Events.EVENT_TIMEZONE, allDay ? "UTC" : java.util.TimeZone.getDefault().getID());
        try {
            return app.getContentResolver().insert(android.provider.CalendarContract.Events.CONTENT_URI, v) != null ? "" : "Termin konnte nicht angelegt werden";
        } catch (Exception e) {
            return "Kalender: " + e.getMessage();
        }
    }

    // ============================================================ Anzeige & System
    @JavascriptInterface
    public String setWallpaper(String imageName, String which) {
        java.io.File f = new java.io.File(imageDir(), new java.io.File(imageName).getName());
        android.graphics.Bitmap b = android.graphics.BitmapFactory.decodeFile(f.getPath());
        if (b == null) return "Kein Bild ausgewählt";
        try {
            android.app.WallpaperManager wm = android.app.WallpaperManager.getInstance(app);
            int flags = "lock".equals(which) ? android.app.WallpaperManager.FLAG_LOCK
                    : "home".equals(which) ? android.app.WallpaperManager.FLAG_SYSTEM
                    : android.app.WallpaperManager.FLAG_SYSTEM | android.app.WallpaperManager.FLAG_LOCK;
            wm.setBitmap(b, null, true, flags);
            return "";
        } catch (Exception e) {
            return "Hintergrundbild: " + e.getMessage();
        }
    }

    private android.view.View overlayView;

    /** Blendet Text über allen Apps ein (seconds 0 = bis zum nächsten Aufruf mit leerem Text). */
    @JavascriptInterface
    public String overlayText(String text, double seconds, String position, int sizeSp, String color, String background) {
        if (!Settings.canDrawOverlays(app)) return "Berechtigung „Über anderen Apps einblenden“ fehlt";
        host.main.post(() -> {
            android.view.WindowManager wm = app.getSystemService(android.view.WindowManager.class);
            if (overlayView != null) {
                try {
                    wm.removeView(overlayView);
                } catch (RuntimeException ignored) {
                    // bereits entfernt
                }
                overlayView = null;
            }
            if (text.isEmpty()) return;
            android.widget.TextView tv = new android.widget.TextView(app);
            tv.setText(text);
            tv.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, Math.max(8, sizeSp));
            int pad = Math.round(12 * app.getResources().getDisplayMetrics().density);
            tv.setPadding(pad, pad / 2, pad, pad / 2);
            try {
                tv.setTextColor(android.graphics.Color.parseColor(color));
                tv.setBackgroundColor(android.graphics.Color.parseColor(background));
            } catch (IllegalArgumentException e) {
                tv.setTextColor(0xFFFFFFFF);
                tv.setBackgroundColor(0xCC000000);
            }
            android.view.WindowManager.LayoutParams lp = new android.view.WindowManager.LayoutParams(
                    android.view.WindowManager.LayoutParams.WRAP_CONTENT, android.view.WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= 26 ? android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : android.view.WindowManager.LayoutParams.TYPE_PHONE,
                    android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    android.graphics.PixelFormat.TRANSLUCENT);
            lp.gravity = android.view.Gravity.CENTER_HORIZONTAL | ("top".equals(position) ? android.view.Gravity.TOP
                    : "bottom".equals(position) ? android.view.Gravity.BOTTOM : android.view.Gravity.CENTER_VERTICAL);
            lp.y = "center".equals(position) ? 0 : pad * 4;
            try {
                wm.addView(tv, lp);
                overlayView = tv;
            } catch (RuntimeException e) {
                toast("Einblenden fehlgeschlagen: " + e.getMessage());
                return;
            }
            if (seconds > 0) {
                android.view.View shown = tv;
                host.main.postDelayed(() -> {
                    if (overlayView != shown) return;
                    try {
                        wm.removeView(shown);
                    } catch (RuntimeException ignored) {
                        // bereits entfernt
                    }
                    overlayView = null;
                }, Math.round(seconds * 1000));
            }
        });
        return "";
    }

    /** Schreibt eine Systemeinstellung (screen_off_timeout in ms, accelerometer_rotation 0/1). */
    @JavascriptInterface
    public String setSystemSetting(String name, int value) {
        if (!Settings.System.canWrite(app)) return "Berechtigung „Systemeinstellungen ändern“ fehlt";
        String key;
        switch (name) {
            case "screen_timeout": key = Settings.System.SCREEN_OFF_TIMEOUT; break;
            case "auto_rotate": key = Settings.System.ACCELEROMETER_ROTATION; break;
            default: return "Unbekannte Einstellung";
        }
        try {
            return Settings.System.putInt(app.getContentResolver(), key, value) ? "" : "Einstellung wurde abgelehnt";
        } catch (RuntimeException e) {
            return "Einstellung: " + e.getMessage();
        }
    }

    @JavascriptInterface
    public int getSystemSetting(String name) {
        String key = "auto_rotate".equals(name) ? Settings.System.ACCELEROMETER_ROTATION : Settings.System.SCREEN_OFF_TIMEOUT;
        return Settings.System.getInt(app.getContentResolver(), key, -1);
    }

    /** Öffnet ein Schnelleinstellungs-Panel bzw. die passende Einstellungsseite. */
    @JavascriptInterface
    public String openPanel(String which) {
        String action;
        switch (which) {
            case "wifi": action = Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS; break;
            case "internet": action = Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_INTERNET_CONNECTIVITY : Settings.ACTION_WIRELESS_SETTINGS; break;
            case "nfc": action = Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_NFC : Settings.ACTION_NFC_SETTINGS; break;
            case "volume": action = Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_VOLUME : Settings.ACTION_SOUND_SETTINGS; break;
            case "bluetooth": action = Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "airplane": action = Settings.ACTION_AIRPLANE_MODE_SETTINGS; break;
            case "location": action = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
            case "hotspot": action = Settings.ACTION_WIRELESS_SETTINGS; break;
            case "data": action = Settings.ACTION_DATA_ROAMING_SETTINGS; break;
            case "display": action = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "battery": action = Intent.ACTION_POWER_USAGE_SUMMARY; break;
            default: action = Settings.ACTION_SETTINGS; break;
        }
        Intent i = new Intent(action);
        return onMain(() -> host.startActivity(i) ? "" : "Einstellungsseite nicht verfügbar", "Öffnen fehlgeschlagen");
    }

    /** Führt einen Shell-Befehl aus (optional mit Root). Ergebnis JSON {out, err, code}. */
    @JavascriptInterface
    public void shell(String command, boolean root, double timeoutSec, String callbackId) {
        new Thread(() -> {
            JSONObject o = new JSONObject();
            try {
                Process p = new ProcessBuilder(root ? new String[] { "su", "-c", command } : new String[] { "sh", "-c", command }).start();
                java.util.concurrent.ExecutorService ex = java.util.concurrent.Executors.newFixedThreadPool(2);
                java.util.concurrent.Future<String> out = ex.submit(() -> readAll(p.getInputStream()));
                java.util.concurrent.Future<String> err = ex.submit(() -> readAll(p.getErrorStream()));
                ex.shutdown();
                long end = System.currentTimeMillis() + (long) (Math.max(1, timeoutSec) * 1000);
                boolean done = false;
                while (!done && System.currentTimeMillis() < end) {
                    try {
                        p.exitValue();
                        done = true;
                    } catch (IllegalThreadStateException running) {
                        Thread.sleep(50);
                    }
                }
                if (!done) p.destroy();
                o.put("out", out.get(2, TimeUnit.SECONDS).trim()).put("err", err.get(2, TimeUnit.SECONDS).trim()).put("code", done ? p.exitValue() : -1);
                if (!done) o.put("error", "Zeitlimit überschritten");
            } catch (Exception e) {
                try {
                    o.put("error", (root ? "Root-Befehl: " : "Befehl: ") + e.getMessage());
                } catch (JSONException ignored) {
                    // nicht erreichbar
                }
            }
            resolve(callbackId, JSONObject.quote(o.toString()));
        }, "Shell").start();
    }

    /** Spracheingabe über die Spracherkennung des Systems (nur mit geöffneter App). */
    @JavascriptInterface
    public void speechInput(String lang, String prompt, String callbackId) {
        host.main.post(() -> {
            Activity a = host.activity();
            if (a == null) {
                resolve(callbackId, "null");
                return;
            }
            Intent i = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, lang.isEmpty() ? Locale.getDefault().toLanguageTag() : lang);
            if (!prompt.isEmpty()) i.putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, prompt);
            pendingSpeechCallback = callbackId;
            try {
                a.startActivityForResult(i, EngineHost.REQ_SPEECH);
            } catch (Exception e) {
                pendingSpeechCallback = null;
                resolve(callbackId, "null");
            }
        });
    }

    // ============================================================ NFC & Verknüpfungen
    /** Wartet (max. 30 s, App geöffnet) auf einen NFC-Tag und beschreibt ihn mit makrostudio://nfc/<id>. */
    @JavascriptInterface
    public void writeNfc(String tagId, String callbackId) {
        host.main.post(() -> {
            Activity a = host.activity();
            android.nfc.NfcAdapter nfc = android.nfc.NfcAdapter.getDefaultAdapter(app);
            if (nfc == null) {
                resolve(callbackId, JSONObject.quote("Dieses Gerät hat kein NFC"));
                return;
            }
            if (!nfc.isEnabled()) {
                resolve(callbackId, JSONObject.quote("NFC ist ausgeschaltet"));
                return;
            }
            if (a == null) {
                resolve(callbackId, JSONObject.quote("Makro Studio muss geöffnet sein"));
                return;
            }
            final boolean[] done = { false };
            Runnable timeout = () -> {
                if (done[0]) return;
                done[0] = true;
                nfc.disableReaderMode(a);
                resolve(callbackId, JSONObject.quote("Kein Tag erkannt (Zeitlimit)"));
            };
            nfc.enableReaderMode(a, tag -> {
                String err;
                android.nfc.NdefMessage msg = new android.nfc.NdefMessage(android.nfc.NdefRecord.createUri("makrostudio://nfc/" + Uri.encode(tagId)));
                try {
                    android.nfc.tech.Ndef ndef = android.nfc.tech.Ndef.get(tag);
                    if (ndef != null) {
                        ndef.connect();
                        if (!ndef.isWritable()) err = "Tag ist schreibgeschützt";
                        else {
                            ndef.writeNdefMessage(msg);
                            err = "";
                        }
                        ndef.close();
                    } else {
                        android.nfc.tech.NdefFormatable f = android.nfc.tech.NdefFormatable.get(tag);
                        if (f == null) err = "Tag unterstützt kein NDEF";
                        else {
                            f.connect();
                            f.format(msg);
                            f.close();
                            err = "";
                        }
                    }
                } catch (Exception e) {
                    err = "Schreiben fehlgeschlagen: " + e.getMessage();
                }
                String result = err;
                host.main.post(() -> {
                    if (done[0]) return;
                    done[0] = true;
                    host.main.removeCallbacks(timeout);
                    nfc.disableReaderMode(a);
                    resolve(callbackId, JSONObject.quote(result));
                });
            }, android.nfc.NfcAdapter.FLAG_READER_NFC_A | android.nfc.NfcAdapter.FLAG_READER_NFC_B | android.nfc.NfcAdapter.FLAG_READER_NFC_F
                    | android.nfc.NfcAdapter.FLAG_READER_NFC_V | android.nfc.NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK, null);
            host.main.postDelayed(timeout, 30_000);
        });
    }

    /** Legt eine Homescreen-Verknüpfung an, die den Auslöser mit der ID startet. */
    @JavascriptInterface
    public String pinShortcut(String id, String label) {
        if (!androidx.core.content.pm.ShortcutManagerCompat.isRequestPinShortcutSupported(app)) return "Der Startbildschirm unterstützt keine Verknüpfungen";
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("makrostudio://run/" + Uri.encode(id))).setClass(app, EventActivity.class);
        androidx.core.content.pm.ShortcutInfoCompat s = new androidx.core.content.pm.ShortcutInfoCompat.Builder(app, "run_" + id)
                .setShortLabel(label.isEmpty() ? "Makro" : label)
                .setIcon(androidx.core.graphics.drawable.IconCompat.createWithResource(app, R.mipmap.ic_launcher))
                .setIntent(i)
                .build();
        return androidx.core.content.pm.ShortcutManagerCompat.requestPinShortcut(app, s, null) ? "" : "Verknüpfung wurde abgelehnt";
    }

    void shutdown() {
        if (tts != null) tts.shutdown();
        if (overlayView != null) {
            try {
                app.getSystemService(android.view.WindowManager.class).removeView(overlayView);
            } catch (RuntimeException ignored) {
                // bereits entfernt
            }
            overlayView = null;
        }
        if (busyLock != null && busyLock.isHeld()) busyLock.release();
    }
}
