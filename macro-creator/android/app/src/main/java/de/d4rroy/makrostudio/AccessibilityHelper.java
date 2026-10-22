package de.d4rroy.makrostudio;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * Bedienungshilfe: erkennt die App im Vordergrund und führt Systemaktionen aus.
 * Bildschirminhalte werden nicht gelesen (canRetrieveWindowContent=false).
 */
public class AccessibilityHelper extends AccessibilityService {
    static volatile AccessibilityHelper instance;
    static volatile String currentPackage = "";
    static volatile String currentActivity = "";
    private final Map<String, Boolean> isAppCache = new HashMap<>();

    static boolean isEnabled(Context c) {
        String s = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return s != null && s.contains(c.getPackageName() + "/");
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        if (event.getClassName() != null && isApp(pkg)) {
            String cls = event.getClassName().toString();
            // Nur echte Activities merken (keine Dialoge oder Layout-Klassen)
            if (cls.contains(".") && !cls.startsWith("android.widget") && !cls.startsWith("android.view")) currentActivity = cls;
        }
        if (pkg.equals(currentPackage) || !isApp(pkg)) return;
        String prev = currentPackage;
        currentPackage = pkg;
        EngineHost host = EngineHost.peek();
        if (host == null) return;
        host.eval("window.MS&&MS.native&&MS.native._appChanged&&MS.native._appChanged("
                + JSONObject.quote(pkg) + "," + JSONObject.quote(NativeBridge.appLabel(this, pkg)) + "," + JSONObject.quote(prev) + ")");
    }

    /** Nur echte Apps (mit Startsymbol) und den Startbildschirm melden – keine Tastatur, Systemleisten usw. */
    private boolean isApp(String pkg) {
        Boolean cached = isAppCache.get(pkg);
        if (cached != null) return cached;
        PackageManager pm = getPackageManager();
        boolean app = pm.getLaunchIntentForPackage(pkg) != null;
        if (!app) {
            ResolveInfo home = pm.resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
            app = home != null && home.activityInfo != null && pkg.equals(home.activityInfo.packageName);
        }
        isAppCache.put(pkg, app);
        return app;
    }

    /** Führt eine Systemaktion aus. Gibt "" oder eine Fehlermeldung zurück. */
    static String perform(String action) {
        AccessibilityHelper s = instance;
        if (s == null) return NOT_ENABLED;
        int id;
        switch (action) {
            case "back": id = GLOBAL_ACTION_BACK; break;
            case "home": id = GLOBAL_ACTION_HOME; break;
            case "recents": id = GLOBAL_ACTION_RECENTS; break;
            case "notifications": id = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quick_settings": id = GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "power_dialog": id = GLOBAL_ACTION_POWER_DIALOG; break;
            case "lock_screen":
                if (Build.VERSION.SDK_INT < 28) return "Bildschirm sperren benötigt Android 9";
                id = GLOBAL_ACTION_LOCK_SCREEN;
                break;
            case "screenshot":
                if (Build.VERSION.SDK_INT < 28) return "Screenshot benötigt Android 9";
                id = GLOBAL_ACTION_TAKE_SCREENSHOT;
                break;
            default: return "Unbekannte Systemaktion";
        }
        return s.performGlobalAction(id) ? "" : "Systemaktion wurde abgelehnt";
    }

    // ------------------------------------------------------- UI-Interaktion
    /** Alle Wurzelknoten der sichtbaren Fenster (App, Systemleisten, Sperrbildschirm). */
    private List<AccessibilityNodeInfo> roots() {
        List<AccessibilityNodeInfo> out = new ArrayList<>();
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r != null) out.add(r);
            }
        } catch (Exception ignored) {
            // Fensterliste nicht verfügbar
        }
        if (out.isEmpty() && getRootInActiveWindow() != null) out.add(getRootInActiveWindow());
        return out;
    }

    private static String nodeText(AccessibilityNodeInfo n) {
        CharSequence t = n.getText();
        CharSequence d = n.getContentDescription();
        return (t == null ? "" : t.toString()) + (d == null ? "" : "\n" + d);
    }

    /** Sucht einen Knoten per Text (enthält/genau/RegEx) oder per View-ID. */
    private AccessibilityNodeInfo find(String mode, String query, String match) {
        String q = query.toLowerCase(Locale.ROOT);
        for (AccessibilityNodeInfo root : roots()) {
            List<AccessibilityNodeInfo> stack = new ArrayList<>();
            stack.add(root);
            while (!stack.isEmpty()) {
                AccessibilityNodeInfo n = stack.remove(stack.size() - 1);
                if (n == null) continue;
                boolean hit;
                if ("id".equals(mode)) {
                    String id = n.getViewIdResourceName();
                    hit = id != null && (id.equals(query) || id.endsWith("/" + query) || id.endsWith(":id/" + query));
                } else {
                    String[] parts = nodeText(n).split("\n");
                    hit = false;
                    for (String p : parts) {
                        String t = p.trim();
                        if (t.isEmpty()) continue;
                        if ("regex".equals(match)) hit |= t.matches(query);
                        else if ("exact".equals(match)) hit |= t.equalsIgnoreCase(query);
                        else hit |= t.toLowerCase(Locale.ROOT).contains(q);
                    }
                }
                if (hit) return n;
                for (int i = n.getChildCount() - 1; i >= 0; i--) stack.add(n.getChild(i));
            }
        }
        return null;
    }

    private float[] toPixels(float x, float y, boolean percent) {
        if (!percent) return new float[] { x, y };
        DisplayMetrics dm = getResources().getDisplayMetrics();
        return new float[] { dm.widthPixels * x / 100f, dm.heightPixels * y / 100f };
    }

    private boolean gesture(Path path, long durationMs) {
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, Math.max(1, durationMs)))
                .build();
        return dispatchGesture(g, null, null);
    }

    private boolean tapAt(float x, float y, boolean longPress) {
        Path p = new Path();
        p.moveTo(x, y);
        return gesture(p, longPress ? 800 : 60);
    }

    /** Tippt auf ein Element. mode: text | id | coords. Gibt "" oder eine Fehlermeldung zurück. */
    static String click(String mode, String query, String match, boolean longPress, float x, float y, boolean percent) {
        AccessibilityHelper s = instance;
        if (s == null) return NOT_ENABLED;
        if ("coords".equals(mode)) {
            float[] px = s.toPixels(x, y, percent);
            return s.tapAt(px[0], px[1], longPress) ? "" : "Tippen fehlgeschlagen";
        }
        AccessibilityNodeInfo n = s.find(mode, query, match);
        if (n == null) return "Element „" + query + "“ nicht gefunden";
        AccessibilityNodeInfo target = n;
        while (target != null && !(longPress ? target.isLongClickable() : target.isClickable())) target = target.getParent();
        if (target != null && target.performAction(longPress ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK)) return "";
        // Nicht klickbar gemeldet → auf die Mitte des Elements tippen
        Rect r = new Rect();
        n.getBoundsInScreen(r);
        return s.tapAt(r.exactCenterX(), r.exactCenterY(), longPress) ? "" : "Tippen fehlgeschlagen";
    }

    static String swipe(float x1, float y1, float x2, float y2, long durationMs, boolean percent) {
        AccessibilityHelper s = instance;
        if (s == null) return NOT_ENABLED;
        float[] a = s.toPixels(x1, y1, percent), b = s.toPixels(x2, y2, percent);
        Path p = new Path();
        p.moveTo(a[0], a[1]);
        p.lineTo(b[0], b[1]);
        return s.gesture(p, durationMs) ? "" : "Wischen fehlgeschlagen";
    }

    /** Setzt Text in das fokussierte (oder erste) Eingabefeld. */
    static String setText(String text) {
        AccessibilityHelper s = instance;
        if (s == null) return NOT_ENABLED;
        AccessibilityNodeInfo field = null;
        for (AccessibilityNodeInfo root : s.roots()) {
            field = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (field != null) break;
        }
        if (field == null) return "Kein Eingabefeld ausgewählt";
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) ? "" : "Text konnte nicht eingegeben werden";
    }

    static boolean screenContains(String query, String match) {
        AccessibilityHelper s = instance;
        return s != null && s.find("text", query, match) != null;
    }

    /** Weckt den Bildschirm, wischt den Sperrbildschirm hoch und tippt die PIN ein. */
    static String pinUnlock(String pin, boolean pressEnter, long digitDelay, long swipeDelay) {
        AccessibilityHelper s = instance;
        if (s == null) return NOT_ENABLED;
        PowerManager pm = s.getSystemService(PowerManager.class);
        if (!pm.isInteractive()) {
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "MakroStudio:unlock");
            wl.acquire(3000);
            SystemClock.sleep(700);
        }
        android.app.KeyguardManager km = s.getSystemService(android.app.KeyguardManager.class);
        if (!km.isKeyguardLocked()) return "";
        DisplayMetrics dm = s.getResources().getDisplayMetrics();
        Path p = new Path();
        p.moveTo(dm.widthPixels / 2f, dm.heightPixels * 0.85f);
        p.lineTo(dm.widthPixels / 2f, dm.heightPixels * 0.25f);
        s.gesture(p, 250);
        SystemClock.sleep(Math.max(300, swipeDelay));
        for (char c : pin.toCharArray()) {
            AccessibilityNodeInfo key = s.find("text", String.valueOf(c), "exact");
            if (key == null) return "Ziffer „" + c + "“ auf dem Sperrbildschirm nicht gefunden";
            AccessibilityNodeInfo target = key;
            while (target != null && !target.isClickable()) target = target.getParent();
            if (target == null || !target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                Rect r = new Rect();
                key.getBoundsInScreen(r);
                s.tapAt(r.exactCenterX(), r.exactCenterY(), false);
            }
            SystemClock.sleep(Math.max(50, digitDelay));
        }
        if (pressEnter) {
            AccessibilityNodeInfo ok = s.find("text", "OK", "exact");
            if (ok == null) ok = s.find("text", "Enter", "contains");
            if (ok == null) ok = s.find("text", "Eingabe", "contains");
            if (ok != null) ok.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        return "";
    }

    /** Schaltet den Bildschirm ein (ohne zu entsperren). */
    @SuppressWarnings("deprecation")
    static String wakeScreen(Context c) {
        PowerManager pm = c.getSystemService(PowerManager.class);
        if (pm.isInteractive()) return "";
        PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "MakroStudio:wake");
        wl.acquire(5000);
        return "";
    }

    /** Screenshot über die Bedienungshilfe (Android 11+). callback erhält Bitmap oder null. */
    static String screenshot(java.util.function.Consumer<android.graphics.Bitmap> callback) {
        AccessibilityHelper s = instance;
        if (s == null) return NOT_ENABLED;
        if (Build.VERSION.SDK_INT < 30) return "Bildvergleich benötigt Android 11 oder neuer";
        s.takeScreenshot(android.view.Display.DEFAULT_DISPLAY, s.getMainExecutor(), new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult result) {
                android.graphics.Bitmap hw = android.graphics.Bitmap.wrapHardwareBuffer(result.getHardwareBuffer(), result.getColorSpace());
                android.graphics.Bitmap bmp = hw == null ? null : hw.copy(android.graphics.Bitmap.Config.ARGB_8888, false);
                result.getHardwareBuffer().close();
                callback.accept(bmp);
            }

            @Override
            public void onFailure(int errorCode) {
                callback.accept(null);
            }
        });
        return "";
    }

    private static final String NOT_ENABLED = "Bedienungshilfe ist nicht aktiviert (Berechtigungen → Bedienungshilfe)";

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }
}
