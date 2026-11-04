package de.d4rroy.makrostudio;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.telephony.TelephonyManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Meldet Geräte-Ereignisse an die Makro-Engine: Bildschirm, Kopfhörer, Netzwerk/WLAN,
 * Flugmodus, Bluetooth, Anrufe, SMS, Musik und installierte Apps.
 */
final class SystemMonitor {
    private final EngineHost host;
    private final Context app;
    private final List<BroadcastReceiver> receivers = new ArrayList<>();
    private ConnectivityManager.NetworkCallback networkCallback;
    private AudioDeviceCallback audioCallback;
    private Object playbackCallback;
    private long audioRegisteredAt;
    private String lastNetwork = "";
    private boolean lastMusic;
    private String lastCallState = TelephonyManager.EXTRA_STATE_IDLE;
    private boolean callWasAnswered;
    private boolean callWasIncoming;
    private String lastNumber = "";

    SystemMonitor(EngineHost host) {
        this.host = host;
        this.app = host.app;
    }

    static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1] == null ? "" : kv[i + 1]);
        } catch (JSONException ignored) {
            // nicht erreichbar
        }
        return o;
    }

    private interface Handler {
        void handle(BroadcastReceiver r, Intent i);
    }

    private void register(IntentFilter filter, Handler handler) {
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                try {
                    handler.handle(this, i);
                } catch (RuntimeException e) {
                    android.util.Log.w("MakroStudio", "Ereignis " + i.getAction() + ": " + e.getMessage());
                }
            }
        };
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, filter, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(r, filter);
        receivers.add(r);
    }

    private boolean granted(String p) {
        return app.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    void start() {
        // Bildschirm an / aus / entsperrt
        IntentFilter screen = new IntentFilter(Intent.ACTION_SCREEN_ON);
        screen.addAction(Intent.ACTION_SCREEN_OFF);
        screen.addAction(Intent.ACTION_USER_PRESENT);
        register(screen, (r, i) -> {
            String a = i.getAction();
            host.event("screen", obj("state", Intent.ACTION_SCREEN_ON.equals(a) ? "on" : Intent.ACTION_SCREEN_OFF.equals(a) ? "off" : "unlocked"));
        });

        // Flugmodus, Bluetooth, WLAN ein/aus
        register(new IntentFilter(Intent.ACTION_AIRPLANE_MODE_CHANGED), (r, i) -> host.event("airplane", obj("on", i.getBooleanExtra("state", false))));
        register(new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), (r, i) -> {
            int s = i.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
            if (s == BluetoothAdapter.STATE_ON || s == BluetoothAdapter.STATE_OFF) host.event("bt_state", obj("on", s == BluetoothAdapter.STATE_ON));
        });
        register(new IntentFilter(WifiManager.WIFI_STATE_CHANGED_ACTION), (r, i) -> {
            if (r.isInitialStickyBroadcast()) return;
            int s = i.getIntExtra(WifiManager.EXTRA_WIFI_STATE, -1);
            if (s == WifiManager.WIFI_STATE_ENABLED || s == WifiManager.WIFI_STATE_DISABLED) host.event("wifi_state", obj("on", s == WifiManager.WIFI_STATE_ENABLED));
        });

        // Energiesparmodus
        register(new IntentFilter(android.os.PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), (r, i) ->
                host.event("power_save", obj("on", app.getSystemService(android.os.PowerManager.class).isPowerSaveMode())));

        // Apps installiert / entfernt
        IntentFilter pkg = new IntentFilter(Intent.ACTION_PACKAGE_ADDED);
        pkg.addAction(Intent.ACTION_PACKAGE_FULLY_REMOVED);
        pkg.addDataScheme("package");
        register(pkg, (r, i) -> {
            if (i.getBooleanExtra(Intent.EXTRA_REPLACING, false) || i.getData() == null) return;
            String p = i.getData().getSchemeSpecificPart();
            boolean added = Intent.ACTION_PACKAGE_ADDED.equals(i.getAction());
            host.event("package", obj("event", added ? "installed" : "removed", "pkg", p, "app", added ? NativeBridge.appLabel(app, p) : p));
        });

        // Anrufe (benötigt „Telefonstatus lesen“, für die Nummer „Anrufliste lesen“)
        register(new IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED), (r, i) -> {
            String state = i.getStringExtra(TelephonyManager.EXTRA_STATE);
            @SuppressWarnings("deprecation")
            String number = i.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
            if (state == null) return;
            // Android schickt den Zustand teils doppelt (mit und ohne Nummer) – nur Wechsel melden
            if (state.equals(lastCallState) && (number == null || number.equals(lastNumber))) return;
            if (number != null && !number.isEmpty()) lastNumber = number;
            String event;
            if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
                event = "incoming";
                callWasIncoming = true;
                callWasAnswered = false;
            } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
                event = callWasIncoming ? "answered" : "outgoing";
                callWasAnswered = true;
            } else {
                event = callWasIncoming && !callWasAnswered ? "missed" : "ended";
                callWasIncoming = false;
                callWasAnswered = false;
            }
            if (state.equals(lastCallState)) return;
            lastCallState = state;
            host.event("call", obj("event", event, "number", lastNumber));
            if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) lastNumber = "";
        });

        // SMS empfangen (benötigt „SMS empfangen“)
        register(new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION), (r, i) -> {
            SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(i);
            if (parts == null || parts.length == 0) return;
            StringBuilder text = new StringBuilder();
            for (SmsMessage m : parts) text.append(m.getMessageBody());
            host.event("sms", obj("from", parts[0].getOriginatingAddress(), "text", text.toString()));
        });

        // Netzwerkart und WLAN-Name
        ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                reportNetwork(caps);
            }

            @Override
            public void onLost(Network network) {
                reportNetwork(null);
            }
        };
        try {
            if (Build.VERSION.SDK_INT >= 26) cm.registerDefaultNetworkCallback(networkCallback, host.main);
            else cm.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException e) {
            networkCallback = null;
        }

        // Kopfhörer (Kabel, USB, Bluetooth)
        AudioManager am = app.getSystemService(AudioManager.class);
        audioRegisteredAt = SystemClock.uptimeMillis();
        audioCallback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] devices) {
                reportHeadphones(devices, true);
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] devices) {
                reportHeadphones(devices, false);
            }
        };
        am.registerAudioDeviceCallback(audioCallback, host.main);

        // Musik startet / stoppt
        lastMusic = am.isMusicActive();
        if (Build.VERSION.SDK_INT >= 26) {
            AudioManager.AudioPlaybackCallback pc = new AudioManager.AudioPlaybackCallback() {
                @Override
                public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> configs) {
                    boolean playing = am.isMusicActive();
                    if (playing == lastMusic) return;
                    lastMusic = playing;
                    host.event("music", obj("playing", playing));
                }
            };
            am.registerAudioPlaybackCallback(pc, host.main);
            playbackCallback = pc;
        }
    }

    private static boolean isHeadphones(int type) {
        return type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_USB_HEADSET
                || (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET);
    }

    private void reportHeadphones(AudioDeviceInfo[] devices, boolean connected) {
        // Direkt nach dem Anmelden meldet Android alle vorhandenen Geräte – das ist kein Ereignis
        if (connected && SystemClock.uptimeMillis() - audioRegisteredAt < 1500) return;
        for (AudioDeviceInfo d : devices) {
            if (!d.isSink() || !isHeadphones(d.getType())) continue;
            boolean bt = d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || (Build.VERSION.SDK_INT >= 31 && d.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET);
            host.event("headphones", obj("connected", connected, "type", bt ? "bluetooth" : "wired", "name", String.valueOf(d.getProductName())));
            return;
        }
    }

    /** Aktuelle Netzwerkart und WLAN-Name als JSON {type, ssid}. */
    JSONObject network(NetworkCapabilities caps) {
        String type = "none", ssid = "";
        if (caps != null) {
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "mobile";
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) type = "ethernet";
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) type = "vpn";
            else type = "other";
        }
        if ("wifi".equals(type)) ssid = currentSsid(caps);
        return obj("type", type, "ssid", ssid);
    }

    @SuppressWarnings("deprecation")
    private String currentSsid(NetworkCapabilities caps) {
        WifiInfo info = null;
        if (Build.VERSION.SDK_INT >= 31 && caps != null && caps.getTransportInfo() instanceof WifiInfo) info = (WifiInfo) caps.getTransportInfo();
        if (info == null || info.getSSID() == null || info.getSSID().contains("unknown ssid")) {
            WifiManager wm = app.getSystemService(WifiManager.class);
            info = wm == null ? null : wm.getConnectionInfo();
        }
        String s = info == null ? null : info.getSSID();
        if (s == null || s.contains("unknown ssid")) return "";
        return s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2 ? s.substring(1, s.length() - 1) : s;
    }

    JSONObject currentNetwork() {
        ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
        Network n = cm.getActiveNetwork();
        return network(n == null ? null : cm.getNetworkCapabilities(n));
    }

    private void reportNetwork(NetworkCapabilities caps) {
        JSONObject n = network(caps);
        String key = n.optString("type") + "|" + n.optString("ssid");
        if (key.equals(lastNetwork)) return;
        lastNetwork = key;
        host.event("network", n);
    }

    boolean headphonesConnected() {
        AudioManager am = app.getSystemService(AudioManager.class);
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (isHeadphones(d.getType())) return true;
        return false;
    }

    String callState() {
        if (!granted(Manifest.permission.READ_PHONE_STATE)) return TelephonyManager.EXTRA_STATE_IDLE.equals(lastCallState) ? "idle" : lastCallState.toLowerCase();
        TelephonyManager tm = app.getSystemService(TelephonyManager.class);
        try {
            @SuppressWarnings("deprecation")
            int s = tm.getCallState();
            return s == TelephonyManager.CALL_STATE_RINGING ? "ringing" : s == TelephonyManager.CALL_STATE_OFFHOOK ? "offhook" : "idle";
        } catch (SecurityException e) {
            return "idle";
        }
    }

    void stop() {
        for (BroadcastReceiver r : receivers) {
            try {
                app.unregisterReceiver(r);
            } catch (RuntimeException ignored) {
                // bereits abgemeldet
            }
        }
        receivers.clear();
        ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
        if (networkCallback != null) {
            try {
                cm.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // bereits abgemeldet
            }
        }
        AudioManager am = app.getSystemService(AudioManager.class);
        if (audioCallback != null) am.unregisterAudioDeviceCallback(audioCallback);
        if (Build.VERSION.SDK_INT >= 26 && playbackCallback != null) am.unregisterAudioPlaybackCallback((AudioManager.AudioPlaybackCallback) playbackCallback);
        networkCallback = null;
        audioCallback = null;
        playbackCallback = null;
    }
}
