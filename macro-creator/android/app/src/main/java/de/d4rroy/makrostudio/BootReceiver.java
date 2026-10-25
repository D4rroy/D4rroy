package de.d4rroy.makrostudio;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

/** Startet den Hintergrunddienst nach dem Gerätestart bzw. nach einem App-Update. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action);
        boolean update = Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        if (!boot && !update) return;
        SharedPreferences p = Prefs.get(context);
        if (!p.getBoolean(Prefs.SERVICE, false) || !p.getBoolean(Prefs.AUTOSTART, false)) return;
        Intent start = new Intent(context, MacroService.class).putExtra(MacroService.EXTRA_BOOT, boot);
        ContextCompat.startForegroundService(context, start);
    }
}
