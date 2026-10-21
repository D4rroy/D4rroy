package de.d4rroy.makrostudio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Vordergrunddienst: hält Makro Studio im Hintergrund am Leben, damit Auslöser auch
 * bei geschlossener App funktionieren. Optional hält er die CPU wach.
 */
public class MacroService extends Service {
    static final String EXTRA_BOOT = "boot";
    private static final String CHANNEL_ID = "service";
    private static final int NOTIFICATION_ID = 1;

    static volatile boolean running;
    private static MacroService current;
    private static String statusText = "Makros werden überwacht";
    private PowerManager.WakeLock wakeLock;

    static void start(Context c) {
        ContextCompat.startForegroundService(c, new Intent(c, MacroService.class));
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, MacroService.class));
    }

    /** Text der Daueranzeige, z. B. „3 Makros aktiv“. */
    static void setStatus(String text) {
        statusText = text;
        MacroService s = current;
        if (s != null) s.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, s.buildNotification());
    }

    static void updateWakeLock() {
        MacroService s = current;
        if (s != null) s.applyWakeLock();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        current = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, getString(R.string.service_channel_name), NotificationManager.IMPORTANCE_LOW);
            ch.setDescription(getString(R.string.service_channel_description));
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
        EngineHost.get(this).ensure();
        applyWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getBooleanExtra(EXTRA_BOOT, false)) EngineHost.get(this).startedByBoot = true;
        return START_STICKY;
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFF2F7DE1)
                .setContentTitle(getString(R.string.service_title))
                .setContentText(statusText)
                .setContentIntent(pi)
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void applyWakeLock() {
        boolean want = Prefs.get(this).getBoolean(Prefs.CPU_WAKE, false);
        if (want && wakeLock == null) {
            wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MakroStudio:engine");
            wakeLock.acquire();
        } else if (!want && wakeLock != null) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        current = null;
        if (wakeLock != null) wakeLock.release();
        wakeLock = null;
        EngineHost.get(this).shutdownIfUnused();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
