package de.d4rroy.makrostudio;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONException;
import org.json.JSONObject;

/** Meldet eingehende Benachrichtigungen anderer Apps an die Makro-Engine. */
public class NotificationWatcher extends NotificationListenerService {
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
