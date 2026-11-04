package de.d4rroy.makrostudio;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.FileInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Bildschirm aus, App geschlossen, Gerät im Tiefschlaf: Intervall-Makros müssen trotzdem
 * auslösen (Android-Wecker), und Wartezeiten dürfen im Hintergrund nicht gedrosselt sein.
 */
@RunWith(AndroidJUnit4.class)
public class ScreenOffTest {
    private static final String TAG = "ScreenOffTest";

    private static String shell(String cmd) throws Exception {
        ParcelFileDescriptor pfd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(cmd);
        StringBuilder sb = new StringBuilder();
        try (FileInputStream in = new FileInputStream(pfd.getFileDescriptor())) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n));
        }
        pfd.close();
        return sb.toString().trim();
    }

    private static String js(String code) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            EngineHost host = EngineHost.peek();
            if (host == null) { done.countDown(); return; }
            WebView web = host.webView();
            web.evaluateJavascript(code, v -> {
                result.set(v);
                done.countDown();
            });
        });
        assertTrue("JavaScript hat nicht geantwortet: " + code, done.await(30, TimeUnit.SECONDS));
        assertNotNull("Engine läuft nicht mehr", result.get());
        return result.get();
    }

    private static int counter() throws InterruptedException {
        return Integer.parseInt(js("MS.vars.get('g:zaehler')"));
    }

    @After
    public void cleanUp() throws Exception {
        shell("dumpsys deviceidle unforce");
        shell("input keyevent KEYCODE_WAKEUP");
        try { js("MS.native.setBackground('service', false); true"); } catch (Throwable ignored) { }
    }

    @Test
    public void intervalFiresWithScreenOffAndInDoze() throws Exception {
        String pkg = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
        shell("appops set " + pkg + " SCHEDULE_EXACT_ALARM allow");
        shell("dumpsys deviceidle whitelist +" + pkg);

        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        long until = SystemClock.uptimeMillis() + 30000;
        while (!"true".equals(js("!!(window.MS && MS.engine && MS.native && MS.native.available)"))) {
            assertTrue("App wurde nicht geladen", SystemClock.uptimeMillis() < until);
            SystemClock.sleep(500);
        }
        js("(function () {"
                + "MS.store.state = MS.store.defaults();"
                + "MS.store.state.variables.push({ name: 'zaehler', type: 'integer', value: 0 });"
                + "var t = MS.catalog.create('trigger', 'interval'); t.params.value = 20; t.params.unit = 's';"
                + "var a = MS.catalog.create('action', 'set_variable'); a.params.var = 'g:zaehler'; a.params.op = 'inc'; a.params.amount = 1;"
                + "MS.store.state.macros.push({ id: 'off', name: 'Display-aus-Test', category: 'Allgemein', enabled: true,"
                + "  triggers: [t], actions: [a], constraints: [], constraintLogic: 'and', localVars: [] });"
                + "MS.store.changed('macros');"
                + "MS.native.setBackground('service', true); return true; })()");
        SystemClock.sleep(3000);
        assertTrue("Hintergrunddienst startet nicht", MacroService.running);

        // App schließen und Display ausschalten
        scenario.moveToState(Lifecycle.State.DESTROYED);
        scenario.close();
        shell("input keyevent KEYCODE_SLEEP");
        SystemClock.sleep(1000);

        // 1) Display aus: 70 s → mindestens 3 Ausführungen
        int before = counter();
        SystemClock.sleep(70_000);
        int screenOff = counter() - before;
        Log.i(TAG, "Display aus: " + screenOff + " Ausführungen in 70 s (Intervall 20 s)");
        assertTrue("Bei ausgeschaltetem Display nur " + screenOff + " Ausführungen in 70 s", screenOff >= 3);

        // 2) Wartezeiten im Hintergrund: 6 × 500 ms müssen etwa 3 s dauern
        js("(function () { window.__waitMs = -1; var w = []; for (var i = 0; i < 6; i++) { var a = MS.catalog.create('action', 'wait'); a.params.value = 500; a.params.unit = 'ms'; w.push(a); }"
                + "var t0 = Date.now(); MS.engine.runActions(w, MS.engine.context({ id: 'w', name: 'Warten' })).then(function () { window.__waitMs = Date.now() - t0; }); return true; })()");
        long waitUntil = SystemClock.uptimeMillis() + 60_000;
        int waitMs = -1;
        while (SystemClock.uptimeMillis() < waitUntil) {
            waitMs = (int) Double.parseDouble(js("window.__waitMs"));
            if (waitMs >= 0) break;
            SystemClock.sleep(250);
        }
        Log.i(TAG, "6 × 500 ms Warten im Hintergrund dauerte " + waitMs + " ms");
        assertTrue("Warten im Hintergrund zu ungenau: " + waitMs + " ms", waitMs >= 2900 && waitMs < 4500);

        // 3) Tiefschlaf erzwingen: der Android-Wecker muss das Makro trotzdem starten
        Log.i(TAG, "Doze: " + shell("dumpsys deviceidle force-idle"));
        before = counter();
        SystemClock.sleep(90_000);
        int doze = counter() - before;
        Log.i(TAG, "Tiefschlaf: " + doze + " Ausführungen in 90 s (Intervall 20 s)");
        assertTrue("Im Tiefschlaf keine Ausführung in 90 s", doze >= 1);
    }
}
