package de.d4rroy.makrostudio;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONException;
import org.json.JSONObject;

/** Meldet eingehende Benachrichtigungen anderer Apps an die Makro-Engine. */
public class NotificationWatcher extends NotificationListenerService {
    static volatile NotificationWatcher instance;

    @Override
    public void onListenerConnected() {
        instance = this;
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
    }

    private static String text(StatusBarNotification sbn) {
        Bundle e = sbn.getNotification().extras;
        CharSequence t = e.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence b = e.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (b == null) b = e.getCharSequence(Notification.EXTRA_TEXT);
        return ((t == null ? "" : t) + "\n" + (b == null ? "" : b)).toLowerCase(java.util.Locale.ROOT);
    }

    private static boolean matches(StatusBarNotification sbn, String pkg, String contains) {
        if (!pkg.isEmpty() && !pkg.equals(sbn.getPackageName())) return false;
        return contains.isEmpty() || text(sbn).contains(contains.toLowerCase(java.util.Locale.ROOT));
    }

    /** Schließt passende Benachrichtigungen. Gibt "" oder eine Fehlermeldung zurück. */
    static String dismiss(String pkg, String contains) {
        NotificationWatcher w = instance;
        if (w == null) return NO_ACCESS;
        int n = 0;
        for (StatusBarNotification sbn : w.getActiveNotifications()) {
            if (!matches(sbn, pkg, contains) || !sbn.isClearable()) continue;
            w.cancelNotification(sbn.getKey());
            n++;
        }
        return n > 0 ? "" : "Keine passende Benachrichtigung gefunden";
    }

    /** Drückt einen Knopf (oder den Inhalt) der ersten passenden Benachrichtigung. */
    static String press(String pkg, String contains, String button) {
        NotificationWatcher w = instance;
        if (w == null) return NO_ACCESS;
        for (StatusBarNotification sbn : w.getActiveNotifications()) {
            if (!matches(sbn, pkg, contains)) continue;
            Notification n = sbn.getNotification();
            try {
                if (button.isEmpty()) {
                    if (n.contentIntent == null) return "Benachrichtigung hat keine Aktion";
                    n.contentIntent.send();
                    return "";
                }
                if (n.actions != null) {
                    for (Notification.Action a : n.actions) {
                        if (a.title != null && a.title.toString().toLowerCase(java.util.Locale.ROOT).contains(button.toLowerCase(java.util.Locale.ROOT))) {
                            a.actionIntent.send();
                            return "";
                        }
                    }
                }
                return "Knopf „" + button + "“ nicht gefunden";
            } catch (android.app.PendingIntent.CanceledException e) {
                return "Aktion nicht mehr verfügbar";
            }
        }
        return "Keine passende Benachrichtigung gefunden";
    }

    private static final String NO_ACCESS = "Benachrichtigungszugriff ist nicht aktiviert (Berechtigungen → Benachrichtigungszugriff)";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (getPackageName().equals(sbn.getPackageName())) return;
        EngineHost host = EngineHost.peek();
        if (host == null) return;
        Bundle extras = sbn.getNotification().extras;
        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = extras.getCharSequence(Notification.EXTRA_TEXT);
        try {
            JSONObject o = new JSONObject()
                    .put("pkg", sbn.getPackageName())
                    .put("app", NativeBridge.appLabel(this, sbn.getPackageName()))
                    .put("title", title == null ? "" : title.toString())
                    .put("text", text == null ? "" : text.toString())
                    .put("ongoing", sbn.isOngoing());
            host.eval("window.MS&&MS.native&&MS.native._notification&&MS.native._notification(" + o + ")");
        } catch (JSONException ignored) {
            // Ungültige Daten überspringen
        }
    }
}
