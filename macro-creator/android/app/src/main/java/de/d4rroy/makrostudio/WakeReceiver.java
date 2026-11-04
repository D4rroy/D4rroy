package de.d4rroy.makrostudio;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.content.ContextCompat;

/**
 * Weckt das Gerät zum nächsten fälligen Zeitpunkt (Uhrzeit, Intervall, Sonnenzeiten),
 * auch im Tiefschlaf (Doze) bei ausgeschaltetem Bildschirm. Danach prüft die Engine
 * sofort, welche Auslöser fällig sind.
 */
public class WakeReceiver extends BroadcastReceiver {
    private static final int REQUEST = 42;

    private static PendingIntent intent(Context c) {
        return PendingIntent.getBroadcast(c, REQUEST, new Intent(c, WakeReceiver.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static boolean canExact(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    }

    /** Plant den nächsten Weckzeitpunkt (Unix-Zeit in ms); 0 löscht ihn. */
    static void schedule(Context c, long at) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = intent(c);
        if (at <= 0) {
            am.cancel(pi);
            return;
        }
        if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    @Override
    public void onReceive(Context context, Intent i) {
        // Kurz wach halten, bis die Engine die fälligen Auslöser geprüft hat
        PowerManager.WakeLock wl = context.getSystemService(PowerManager.class)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MakroStudio:alarm");
        wl.acquire(60_000);
        EngineHost host = EngineHost.peek();
        if (host != null) {
            host.eval("window.MS&&MS.engine&&MS.engine.onWake&&MS.engine.onWake()");
        } else if (Prefs.get(context).getBoolean(Prefs.SERVICE, false)) {
            // Engine läuft nicht mehr (z. B. vom System beendet) → Dienst neu starten
            ContextCompat.startForegroundService(context, new Intent(context, MacroService.class));
        }
    }
}
