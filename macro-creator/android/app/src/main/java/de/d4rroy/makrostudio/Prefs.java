package de.d4rroy.makrostudio;

import android.content.Context;
import android.content.SharedPreferences;

/** Einstellungen, die Android auch ohne laufende Web-App kennen muss (z. B. beim Gerätestart). */
final class Prefs {
    static final String SERVICE = "service";
    static final String AUTOSTART = "autostart";
    static final String CPU_WAKE = "cpu_wake";
    static final String VOLUME_WATCH = "volume_watch";
    static final String VOLUME_CONSUME = "volume_consume";
    static final String WEBHOOK_PORT = "webhook_port";
    static final String WEBHOOK_TOKEN = "webhook_token";
    static final String SMS_ALLOWED = "sms_send";

    private Prefs() {
    }

    static SharedPreferences get(Context c) {
        return c.getApplicationContext().getSharedPreferences("makrostudio", Context.MODE_PRIVATE);
    }
}
