package de.d4rroy.makrostudio;

import android.accessibilityservice.AccessibilityService;
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
        if (s == null) return "Bedienungshilfe ist nicht aktiviert (Berechtigungen → Bedienungshilfe)";
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

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }
}
