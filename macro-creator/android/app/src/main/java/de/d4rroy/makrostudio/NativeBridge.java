package de.d4rroy.makrostudio;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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

    private final MainActivity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;
    private boolean ttsReady;
    private final List<Runnable> ttsQueue = new ArrayList<>();

    private volatile boolean torchOn;
    private volatile boolean fullscreen;
    private String pendingSave;
    private final Map<Integer, String[]> permissionRequests = new HashMap<>();
    private int nextRequest = 100;
    private int nextNotification = 1;

    NativeBridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        createNotificationChannel();
        CameraManager cm = (CameraManager) activity.getSystemService(Context.CAMERA_SERVICE);
        if (cm != null) {
            cm.registerTorchCallback(new CameraManager.TorchCallback() {
                @Override
                public void onTorchModeChanged(String cameraId, boolean enabled) {
                    torchOn = enabled;
                }
            }, main);
        }
    }

    // ------------------------------------------------------------ Hilfen
    private void js(String code) {
        main.post(() -> web.evaluateJavascript(code, null));
    }

    private void resolve(String id, String jsValue) {
        if (id == null || id.isEmpty()) return;
        js("window.MS&&MS.native&&MS.native._resolve(" + JSONObject.quote(id) + "," + jsValue + ")");
    }

    private void toast(String message) {
        js("window.MS&&MS.ui&&MS.ui.toast(" + JSONObject.quote(message) + ")");
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
        main.post(task);
        try {
            return task.get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            return fallback;
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
        int[] b = readBattery(activity.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)));
        return "{\"level\":" + b[0] + ",\"charging\":" + (b[1] == 1) + "}";
    }

    // ---------------------------------------------------- Benachrichtigungen
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                activity.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(activity.getString(R.string.channel_description));
        activity.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return NotificationManagerCompat.from(activity).areNotificationsEnabled();
    }

    @JavascriptInterface
    public boolean showNotification(String title, String text) {
        if (!notificationsAllowed()) return false;
        Intent open = new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(activity, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(activity, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFF2F7DE1)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(activity).notify(nextNotification++, b.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }

    // ---------------------------------------------------- Berechtigungen
    @JavascriptInterface
    public void requestPermission(String which, String callbackId) {
        String[] perms;
        if ("notifications".equals(which)) {
            if (Build.VERSION.SDK_INT < 33) {
                if (!notificationsAllowed()) openNotificationSettings();
                resolve(callbackId, String.valueOf(notificationsAllowed()));
                return;
            }
            perms = new String[] { Manifest.permission.POST_NOTIFICATIONS };
        } else if ("location".equals(which)) {
            perms = new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION };
        } else {
            resolve(callbackId, "false");
            return;
        }
        int code;
        synchronized (this) {
            code = nextRequest++;
            permissionRequests.put(code, new String[] { callbackId, which });
        }
        main.post(() -> activity.requestPermissions(perms, code));
    }

    void onPermissionResult(int code, boolean granted) {
        String[] req;
        synchronized (this) {
            req = permissionRequests.remove(code);
        }
        if (req == null) return;
        if ("notifications".equals(req[1])) {
            // Nach zweimaliger Ablehnung fragt Android nicht mehr – dann die Einstellungen öffnen
            if (!granted && !notificationsAllowed()) openNotificationSettings();
            granted = granted || notificationsAllowed();
        }
        resolve(req[0], String.valueOf(granted));
    }

    private void openNotificationSettings() {
        main.post(() -> {
            Intent i = Build.VERSION.SDK_INT >= 26
                    ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName())
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName()));
            try {
                activity.startActivity(i);
            } catch (ActivityNotFoundException ignored) {
                // Keine Einstellungsseite vorhanden
            }
        });
    }

    // --------------------------------------------------------- Vibration
    @JavascriptInterface
    public boolean vibrate(String pattern) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm == null ? null : vm.getDefaultVibrator();
        } else {
            v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
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
        main.post(() -> {
            Runnable job = () -> {
                tts.setLanguage(Locale.forLanguageTag(lang));
                tts.setSpeechRate((float) rate);
                tts.setPitch((float) pitch);
                String id = callbackId.isEmpty() ? "u" + System.nanoTime() : callbackId;
                if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) resolve(callbackId, "false");
            };
            if (tts == null) {
                tts = new TextToSpeech(activity, status -> {
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
        main.post(() -> {
            if (tts != null) tts.stop();
        });
    }

    // ------------------------------------------------------ Taschenlampe
    @JavascriptInterface
    public String torch(boolean on) {
        CameraManager cm = (CameraManager) activity.getSystemService(Context.CAMERA_SERVICE);
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
        main.post(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @JavascriptInterface
    public void fullscreen(boolean on) {
        fullscreen = on;
        main.post(() -> {
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
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

    // ------------------------------------------------- Teilen & Öffnen
    @JavascriptInterface
    public void copy(String text) {
        main.post(() -> {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Makro Studio", text));
        });
    }

    @JavascriptInterface
    public void share(String title, String text) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        main.post(() -> activity.startActivity(Intent.createChooser(send, title.isEmpty() ? null : title)));
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
                activity.startActivity(i);
                return "";
            } catch (ActivityNotFoundException e) {
                return "Keine App gefunden, die diese Adresse öffnen kann";
            } catch (Exception e) {
                return "Öffnen fehlgeschlagen: " + e.getMessage();
            }
        }, "Öffnen fehlgeschlagen");
    }

    // ---------------------------------------------------------- Dateien
    @JavascriptInterface
    public void saveFile(String name, String content) {
        main.post(() -> {
            pendingSave = content;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json")
                    .putExtra(Intent.EXTRA_TITLE, name);
            try {
                activity.startActivityForResult(i, MainActivity.REQ_SAVE);
            } catch (ActivityNotFoundException e) {
                pendingSave = null;
                toast("Kein Dateimanager zum Speichern gefunden");
            }
        });
    }

    void onSaveResult(Uri uri) {
        String content = pendingSave;
        pendingSave = null;
        if (uri == null || content == null) return;
        try (OutputStream os = activity.getContentResolver().openOutputStream(uri)) {
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
