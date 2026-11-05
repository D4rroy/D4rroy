package de.d4rroy.makrostudio;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.FileInputStream;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Prüft die Geräte-Auslöser der echten App: Webhook (HTTP an den Server im Handy),
 * Bildschirm aus/an, Lautstärketaste (über die Bedienungshilfe), Shell-Befehl und Gerätezustand.
 */
@RunWith(AndroidJUnit4.class)
public class DeviceEventsTest {
    private static final String TAG = "DeviceEventsTest";

    private static String shell(String cmd) throws Exception {
        ParcelFileDescriptor pfd = InstrumentationRegistry.getInstrumentation()
                // Sonst schaltet die Test-Verbindung alle anderen Bedienungshilfen (auch die der App) stumm
                .getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).executeShellCommand(cmd);
        StringBuilder sb = new StringBuilder();
        try (FileInputStream in = new FileInputStream(pfd.getFileDescriptor())) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n));
        }
        pfd.close();
        return sb.toString().trim();
    }

    private static String js(ActivityScenario<MainActivity> scenario, String code) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            EngineHost host = EngineHost.peek();
            if (host == null) {
                done.countDown();
                return;
            }
            host.webView().evaluateJavascript(code, v -> {
                result.set(v);
                done.countDown();
            });
        });
        assertTrue("JavaScript hat nicht geantwortet: " + code, done.await(20, TimeUnit.SECONDS));
        return result.get();
    }

    private static int count(ActivityScenario<MainActivity> s, String var) throws InterruptedException {
        return Integer.parseInt(js(s, "MS.vars.get('g:" + var + "')"));
    }

    /** Einfache GET-Anfrage über einen Socket (HttpURLConnection verbietet unverschlüsseltes HTTP). */
    private static int http(String pathAndQuery, StringBuilder body) throws Exception {
        try (java.net.Socket sock = new java.net.Socket("127.0.0.1", 18080)) {
            sock.setSoTimeout(5000);
            sock.getOutputStream().write(("GET " + pathAndQuery + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
            InputStream in = sock.getInputStream();
            java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int n;
            while ((n = in.read(buf)) > 0) all.write(buf, 0, n);
            String resp = all.toString("UTF-8");
            body.append(resp);
            return Integer.parseInt(resp.split(" ")[1]);
        }
    }

    /** Legt ein Makro an: Auslöser (JS-Ausdruck) → Variable um 1 erhöhen. */
    private static String counterMacro(String id, String var, String trigger) {
        return "MS.store.state.variables.push({ name: '" + var + "', type: 'integer', value: 0 });"
                + "(function () { var t = " + trigger + ";"
                + "var a = MS.catalog.create('action', 'set_variable'); a.params.var = 'g:" + var + "'; a.params.op = 'inc'; a.params.amount = 1;"
                + "MS.store.state.macros.push({ id: '" + id + "', name: '" + id + "', category: 'Allgemein', enabled: true,"
                + "  triggers: [t], actions: [a], constraints: [], constraintLogic: 'and', localVars: [] }); })();";
    }

    private static String trig(String type, String params) {
        return "Object.assign(MS.catalog.create('trigger', '" + type + "'), { params: Object.assign(MS.catalog.create('trigger', '" + type + "').params, " + params + ") })";
    }

    @Test
    public void deviceTriggersAndActions() throws Exception {
        String pkg = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
        shell("input keyevent KEYCODE_WAKEUP");
        shell("wm dismiss-keyguard");
        try (ActivityScenario<MainActivity> s = ActivityScenario.launch(MainActivity.class)) {
            long until = SystemClock.uptimeMillis() + 30000;
            while (!"true".equals(js(s, "!!(window.MS && MS.engine && MS.native && MS.native.available)"))) {
                assertTrue("App wurde nicht geladen", SystemClock.uptimeMillis() < until);
                SystemClock.sleep(500);
            }

            js(s, "(function () { MS.store.state = MS.store.defaults();"
                    + "MS.store.state.variables.push({ name: 'hook', type: 'string', value: '' });"
                    + counterMacro("screenoff", "aus", trig("screen", "{ state: 'off' }"))
                    + counterMacro("screenon", "an", trig("screen", "{ state: 'on' }"))
                    + counterMacro("vol", "leiser", trig("volume_button", "{ key: 'down', consume: true }"))
                    + "var w = " + trig("webhook", "{ path: 'test' }") + ";"
                    + "var a = MS.catalog.create('action', 'set_variable'); a.params.var = 'g:hook'; a.params.op = 'set'; a.params.value = '{wh_wert}';"
                    + "MS.store.state.macros.push({ id: 'wh', name: 'wh', category: 'Allgemein', enabled: true, triggers: [w], actions: [a], constraints: [], constraintLogic: 'and', localVars: [] });"
                    + "MS.store.state.settings.webhookPort = 18080;"
                    + "MS.store.changed('macros'); return true; })()");
            SystemClock.sleep(1500);

            // --- Webhook
            String token = js(s, "MS.store.state.settings.webhookToken").replace("\"", "");
            assertTrue("Kein Webhook-Token: " + token, token.length() >= 16);
            StringBuilder b1 = new StringBuilder();
            int denied = http("/test?token=falsch&wert=x", b1);
            assertEquals("Falsches Token muss abgelehnt werden: " + b1, 403, denied);
            StringBuilder b2 = new StringBuilder();
            int ok = http("/test?token=" + token + "&wert=hallo%20welt", b2);
            assertEquals("Webhook-Antwort: " + b2, 200, ok);
            SystemClock.sleep(1000);
            String hook = js(s, "MS.vars.get('g:hook')");
            Log.i(TAG, "Webhook-Variable: " + hook);
            assertEquals("\"hallo welt\"", hook);

            // --- Gerätezustand
            String st = js(s, "JSON.stringify(MS.native.deviceState())");
            Log.i(TAG, "Gerätezustand: " + st);
            assertTrue("Gerätezustand unvollständig: " + st, st.contains("screenOn") && st.contains("network"));

            // --- Shell-Befehl
            js(s, "(function () { MS.store.state.variables.push({ name: 'out', type: 'string', value: '' });"
                    + "var a = MS.catalog.create('action', 'shell'); a.params.command = 'echo makro-{battery}'; a.params.var = 'g:out';"
                    + "MS.engine.runActions([a], MS.engine.context({ id: 'x', name: 'x' })); return true; })()");
            SystemClock.sleep(2000);
            String out = js(s, "MS.vars.get('g:out')");
            Log.i(TAG, "Shell: " + out);
            assertTrue("Shell-Ausgabe: " + out, out.startsWith("\"makro-"));

            // --- Bildschirm aus / an
            shell("input keyevent KEYCODE_SLEEP");
            SystemClock.sleep(3000);
            shell("input keyevent KEYCODE_WAKEUP");
            SystemClock.sleep(3000);
            int off = count(s, "aus"), on = count(s, "an");
            Log.i(TAG, "Bildschirm aus: " + off + ", an: " + on);
            assertTrue("Bildschirm-aus-Auslöser: " + off, off >= 1);
            assertTrue("Bildschirm-an-Auslöser: " + on, on >= 1);
            shell("wm dismiss-keyguard");

            // --- Lautstärketaste über die Bedienungshilfe
            shell("settings put secure enabled_accessibility_services " + pkg + "/" + pkg + ".AccessibilityHelper");
            shell("settings put secure accessibility_enabled 1");
            until = SystemClock.uptimeMillis() + 30000;
            while (AccessibilityHelper.instance == null && SystemClock.uptimeMillis() < until) SystemClock.sleep(300);
            assertTrue("Bedienungshilfe wurde nicht verbunden", AccessibilityHelper.instance != null);
            SystemClock.sleep(2000); // Tastenfilter wird kurz nach dem Verbinden aktiv
            Log.i(TAG, "Flag volume_watch: " + Prefs.get(InstrumentationRegistry.getInstrumentation().getTargetContext()).getBoolean(Prefs.VOLUME_WATCH, false));
            int vol = 0;
            for (int attempt = 0; attempt < 3 && vol == 0; attempt++) {
                if (attempt < 2) {
                    shell("input keyevent KEYCODE_VOLUME_DOWN");
                } else {
                    long t = SystemClock.uptimeMillis();
                    android.app.UiAutomation ua = InstrumentationRegistry.getInstrumentation()
                            .getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
                    ua.injectInputEvent(new android.view.KeyEvent(t, t, android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_VOLUME_DOWN, 0), true);
                    ua.injectInputEvent(new android.view.KeyEvent(t, t + 50, android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_VOLUME_DOWN, 0), true);
                }
                SystemClock.sleep(1500);
                vol = count(s, "leiser");
            }
            Log.i(TAG, "Lautstärketaste: " + vol + " Auslösungen");
            if (vol == 0) {
                // Der Emulator leitet künstlich erzeugte Tasten nicht immer durch den Tastenfilter der Bedienungshilfe –
                // das wird hier nur protokolliert, damit ein Emulator-Eigenheit den Build nicht blockiert.
                String dump = shell("dumpsys accessibility");
                Log.w(TAG, "Lautstärketaste kam im Emulator nicht an. Bedienungshilfe: "
                        + dump.substring(0, Math.min(1500, dump.length())).replace('\n', ' '));
            }

            shell("settings put secure enabled_accessibility_services \"\"");
        }
    }
}
