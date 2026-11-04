package de.d4rroy.makrostudio;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.MutableContextWrapper;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * Hält die WebView mit der Makro-Engine. Sie lebt unabhängig von der Activity: Ist der
 * Hintergrunddienst aktiv, laufen die Makros weiter, auch wenn die App geschlossen wird.
 * Beim Öffnen der App wird dieselbe WebView wieder angezeigt.
 */
final class EngineHost {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/assets/index.html";
    static final int REQ_FILE = 1;
    static final int REQ_SAVE = 2;
    static final int REQ_GEO = 3;
    static final int REQ_IMAGE = 4;
    static final int REQ_FOLDER = 5;
    static final int REQ_SPEECH = 6;

    private static EngineHost instance;

    final Context app;
    final Handler main = new Handler(Looper.getMainLooper());
    private MutableContextWrapper context;
    private WebView web;
    private NativeBridge bridge;
    private Activity activity;
    private BroadcastReceiver batteryReceiver;
    private BroadcastReceiver bluetoothReceiver;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    volatile boolean startedByBoot;
    private SystemMonitor monitor;
    private WebhookServer webhook;
    /** Ereignisse, die eintreffen, bevor die Web-App bereit ist (z. B. Start durch NFC oder Kachel). */
    private final java.util.ArrayList<String> pendingEvents = new java.util.ArrayList<>();
    private volatile boolean ready;

    /**
     * Sekundentakt für die Engine. Er läuft über Android statt über JavaScript-Timer,
     * weil die WebView ihre Timer im Hintergrund stark drosselt.
     */
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (web == null) return;
            web.evaluateJavascript("window.MS&&MS.device&&MS.device._tick&&MS.device._tick()", null);
            main.postDelayed(this, 1000);
        }
    };

    private EngineHost(Context app) {
        this.app = app;
    }

    static synchronized EngineHost get(Context c) {
        if (instance == null) instance = new EngineHost(c.getApplicationContext());
        return instance;
    }

    /** Die Instanz, falls schon eine Engine läuft – sonst null (startet keine neue). */
    static synchronized EngineHost peek() {
        return instance != null && instance.web != null ? instance : null;
    }

    WebView webView() {
        return web;
    }

    Activity activity() {
        return activity;
    }

    NativeBridge bridge() {
        return bridge;
    }

    /** Führt JavaScript in der Engine aus (von jedem Thread aus). */
    void eval(String code) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript(code, null);
        });
    }

    /** Startet ein Android-Fenster – aus der App heraus oder (mit Bedienungshilfe/Overlay) aus dem Hintergrund. */
    boolean startActivity(Intent intent) {
        try {
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                app.startActivity(intent);
            }
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** Meldet ein Geräte-Ereignis an die Engine (MS.bus: 'sys:' + name). */
    void event(String name, org.json.JSONObject data) {
        String payload = org.json.JSONObject.quote(name) + "," + (data == null ? "{}" : data.toString());
        synchronized (pendingEvents) {
            if (!ready || web == null) {
                if (pendingEvents.size() < 50) pendingEvents.add("[" + payload + "]");
                return;
            }
        }
        eval("window.MS&&MS.native&&MS.native._event&&MS.native._event(" + payload + ")");
    }

    /** Die Web-App ist geladen: zwischengespeicherte Ereignisse abholen. */
    String engineReady() {
        synchronized (pendingEvents) {
            ready = true;
            String out = "[" + android.text.TextUtils.join(",", pendingEvents) + "]";
            pendingEvents.clear();
            return out;
        }
    }

    SystemMonitor monitor() {
        return monitor;
    }

    /** Startet oder stoppt den Webhook-Server nach den gespeicherten Einstellungen. */
    void updateWebhook() {
        if (webhook != null) webhook.stop();
        webhook = null;
        int port = Prefs.get(app).getInt(Prefs.WEBHOOK_PORT, 0);
        if (port > 0 && web != null) {
            webhook = new WebhookServer(this, port, Prefs.get(app).getString(Prefs.WEBHOOK_TOKEN, ""));
            webhook.start();
        }
    }

    private void stopMonitors() {
        if (monitor != null) monitor.stop();
        monitor = null;
        if (webhook != null) webhook.stop();
        webhook = null;
        ready = false;
    }

    // ------------------------------------------------------------ Engine
    @SuppressLint("SetJavaScriptEnabled")
    void ensure() {
        if (web != null) return;
        context = new MutableContextWrapper(app);
        web = new WebView(context);
        bridge = new NativeBridge(this);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(app))
                .build();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(bridge, "MakroAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // Renderer abgestürzt oder vom System beendet: Engine neu starten statt die ganze App zu beenden
                android.util.Log.w("MakroStudio", "WebView-Renderer beendet (crash=" + detail.didCrash() + "), Engine wird neu gestartet");
                restartEngine();
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                // Externe Links, tel:, sms:, mailto: usw. in der passenden App öffnen
                bridge.openExternal(uri.toString());
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else if (activity != null) {
                    geoOrigin = origin;
                    geoCallback = callback;
                    activity.requestPermissions(new String[] {
                            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_GEO);
                } else {
                    callback.invoke(origin, false, false);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (activity == null) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    activity.startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        ready = false;
        web.loadUrl(START_URL);
        registerBatteryReceiver();
        monitor = new SystemMonitor(this);
        try {
            monitor.start();
        } catch (RuntimeException e) {
            android.util.Log.w("MakroStudio", "Systemmonitor: " + e.getMessage());
        }
        updateWebhook();
        main.postDelayed(ticker, 1000);
    }

    /** Ersetzt eine nicht mehr nutzbare WebView durch eine neue (gleicher Zustand aus dem Speicher). */
    private void restartEngine() {
        main.removeCallbacks(ticker);
        WebView old = web;
        if (old != null && old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
        if (batteryReceiver != null) app.unregisterReceiver(batteryReceiver);
        if (bluetoothReceiver != null) app.unregisterReceiver(bluetoothReceiver);
        batteryReceiver = null;
        bluetoothReceiver = null;
        stopMonitors();
        if (bridge != null) bridge.shutdown();
        web = null;
        bridge = null;
        if (old != null) old.destroy();
        Activity a = activity;
        if (a != null) attach(a);
        else if (MacroService.running) ensure();
    }

    boolean hasLocationPermission() {
        return app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || app.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Meldet jede Akkuänderung an die Web-App (Auslöser „Akkustand“ und „Stromanschluss“). */
    private int lastTemp = Integer.MIN_VALUE / 2;

    private void registerBatteryReceiver() {
        batteryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                int[] b = NativeBridge.readBattery(intent);
                if (b[0] < 0) return;
                eval("window.MS&&MS.native&&MS.native._battery&&MS.native._battery(" + b[0] + "," + (b[1] == 1) + ")");
                int temp = intent.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                if (temp != Integer.MIN_VALUE && Math.abs(temp - lastTemp) >= 5) {
                    lastTemp = temp;
                    event("battery_temp", SystemMonitor.obj("celsius", temp / 10.0));
                }
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(batteryReceiver, filter, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(batteryReceiver, filter);

        // Bluetooth-Geräte verbunden/getrennt (ab Android 12 nur mit Berechtigung „Geräte in der Nähe“)
        bluetoothReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                android.bluetooth.BluetoothDevice dev = intent.getParcelableExtra(android.bluetooth.BluetoothDevice.EXTRA_DEVICE);
                boolean connected = android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction());
                String name = "", address = "";
                try {
                    if (dev != null) {
                        address = dev.getAddress();
                        name = dev.getName() == null ? "" : dev.getName();
                    }
                } catch (SecurityException ignored) {
                    // ohne Berechtigung kein Gerätename
                }
                eval("window.MS&&MS.native&&MS.native._bluetooth&&MS.native._bluetooth(" + connected + ","
                        + org.json.JSONObject.quote(name) + "," + org.json.JSONObject.quote(address) + ")");
            }
        };
        IntentFilter bt = new IntentFilter(android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED);
        bt.addAction(android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(bluetoothReceiver, bt, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(bluetoothReceiver, bt);
    }

    /** Beendet die Engine (nur wenn weder App noch Hintergrunddienst sie brauchen). */
    void shutdownIfUnused() {
        if (activity != null || MacroService.running || web == null) return;
        main.removeCallbacks(ticker);
        WakeReceiver.schedule(app, 0); // ohne Engine keine Wecker mehr
        if (batteryReceiver != null) app.unregisterReceiver(batteryReceiver);
        if (bluetoothReceiver != null) app.unregisterReceiver(bluetoothReceiver);
        batteryReceiver = null;
        bluetoothReceiver = null;
        stopMonitors();
        bridge.shutdown();
        web.destroy();
        web = null;
        bridge = null;
    }

    // ---------------------------------------------------------- Activity
    void attach(Activity a) {
        ensure();
        activity = a;
        context.setBaseContext(a);
        if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
        a.setContentView(web);
    }

    void detach(Activity a) {
        if (activity != a) return;
        activity = null;
        if (web != null) {
            if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
            context.setBaseContext(app);
        }
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = null;
        shutdownIfUnused();
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else if (requestCode == REQ_IMAGE && bridge != null) {
            bridge.onImagePicked(resultCode == Activity.RESULT_OK && data != null ? data.getData() : null);
        } else if ((requestCode == REQ_FOLDER || requestCode == REQ_SPEECH) && bridge != null) {
            bridge.onActivityResult(requestCode, resultCode, data);
        } else if (requestCode == REQ_SAVE && bridge != null) {
            bridge.onSaveResult(resultCode == Activity.RESULT_OK && data != null ? data.getData() : null);
        }
    }

    void onPermissionResult(int requestCode, boolean granted) {
        if (requestCode == REQ_GEO) {
            if (geoCallback != null) geoCallback.invoke(geoOrigin, granted, false);
            geoCallback = null;
        } else if (bridge != null) {
            bridge.onPermissionResult(requestCode, granted);
        }
    }
}
