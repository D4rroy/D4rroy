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
            case "bluetooth":
                if (Build.VERSION.SDK_INT >= 31) runtime = new String[] { Manifest.permission.BLUETOOTH_CONNECT };
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
                resolve(callbackId, JSONObject.quote("{\"error\":\"Screenshot nicht möglich\"}"));
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
        }), "Screenshot fehlgeschlagen");
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

    void shutdown() {
        if (tts != null) tts.shutdown();
    }
}
