package de.d4rroy.makrostudio;

import android.content.Context;
import android.content.SharedPreferences;

/** Einstellungen, die Android auch ohne laufende Web-App kennen muss (z. B. beim Gerätestart). */
final class Prefs {
    static final String SERVICE = "service";
    static final String AUTOSTART = "autostart";
    static final String CPU_WAKE = "cpu_wake";

    private Prefs() {
    }

    static SharedPreferences get(Context c) {
        return c.getApplicationContext().getSharedPreferences("makrostudio", Context.MODE_PRIVATE);
    }
}
