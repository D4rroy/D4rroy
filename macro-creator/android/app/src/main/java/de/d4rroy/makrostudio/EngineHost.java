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

    private static EngineHost instance;

    final Context app;
    final Handler main = new Handler(Looper.getMainLooper());
    private MutableContextWrapper context;
    private WebView web;
    private NativeBridge bridge;
    private Activity activity;
    private BroadcastReceiver batteryReceiver;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    volatile boolean startedByBoot;

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

        web.loadUrl(START_URL);
        registerBatteryReceiver();
    }

    boolean hasLocationPermission() {
        return app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || app.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Meldet jede Akkuänderung an die Web-App (Auslöser „Akkustand“ und „Stromanschluss“). */
    private void registerBatteryReceiver() {
        batteryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                int[] b = NativeBridge.readBattery(intent);
                if (b[0] < 0) return;
                eval("window.MS&&MS.native&&MS.native._battery&&MS.native._battery(" + b[0] + "," + (b[1] == 1) + ")");
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(batteryReceiver, filter, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(batteryReceiver, filter);
    }

    /** Beendet die Engine (nur wenn weder App noch Hintergrunddienst sie brauchen). */
    void shutdownIfUnused() {
        if (activity != null || MacroService.running || web == null) return;
        if (batteryReceiver != null) app.unregisterReceiver(batteryReceiver);
        batteryReceiver = null;
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
