package de.d4rroy.makrostudio;

import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.util.Log;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Prüft in der echten App (WebView + Android-Brücke), dass ein Makro mit dem
 * Auslöser „Regelmäßiges Intervall“ wiederholt ausgeführt wird – im Vordergrund
 * und nachdem die App wie per Zurück-Taste in den Hintergrund geschickt wurde.
 */
@RunWith(AndroidJUnit4.class)
public class IntervalTriggerTest {
    private static final String TAG = "IntervalTriggerTest";

    private static String js(ActivityScenario<MainActivity> scenario, String code) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(a -> a.getWebView().evaluateJavascript(code, v -> {
            result.set(v);
            done.countDown();
        }));
        assertTrue("JavaScript hat nicht geantwortet: " + code, done.await(20, TimeUnit.SECONDS));
        return result.get();
    }

    private static int counter(ActivityScenario<MainActivity> scenario) throws InterruptedException {
        return Integer.parseInt(js(scenario, "MS.vars.get('g:zaehler')"));
    }

    @Test
    public void intervalMacroFiresInForegroundAndBackground() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // Warten, bis die App geladen ist
            long until = SystemClock.uptimeMillis() + 30000;
            while (!"true".equals(js(scenario, "!!(window.MS && MS.engine && MS.native && MS.native.available)"))) {
                assertTrue("App wurde nicht geladen", SystemClock.uptimeMillis() < until);
                SystemClock.sleep(500);
            }

            // Makro: alle 2 Sekunden die Variable „zaehler“ um 1 erhöhen
            js(scenario, "(function () {"
                    + "MS.store.state = MS.store.defaults();"
                    + "MS.store.state.variables.push({ name: 'zaehler', type: 'integer', value: 0 });"
                    + "var t = MS.catalog.create('trigger', 'interval'); t.params.value = 2; t.params.unit = 's';"
                    + "var a = MS.catalog.create('action', 'set_variable'); a.params.var = 'g:zaehler'; a.params.op = 'inc'; a.params.amount = 1;"
                    + "MS.store.state.macros.push({ id: 'iv', name: 'Intervall-Test', category: 'Allgemein', enabled: true,"
                    + "  triggers: [t], actions: [a], constraints: [], constraintLogic: 'and', localVars: [] });"
                    + "MS.store.changed('macros'); return true; })()");

            SystemClock.sleep(11000);
            int foreground = counter(scenario);
            Log.i(TAG, "Vordergrund: " + foreground + " Ausführungen in 11 s");
            assertTrue("Im Vordergrund nur " + foreground + " Ausführungen in 11 s (erwartet ≥ 4)", foreground >= 4);

            // In den Hintergrund wie mit der Zurück-Taste auf der Startseite
            scenario.onActivity(a -> a.moveTaskToBack(true));
            long stopUntil = SystemClock.uptimeMillis() + 10000;
            while (scenario.getState() != Lifecycle.State.CREATED) {
                assertTrue("App ging nicht in den Hintergrund", SystemClock.uptimeMillis() < stopUntil);
                SystemClock.sleep(200);
            }
            int before = counter(scenario);
            SystemClock.sleep(20000);
            int background = counter(scenario) - before;
            Log.i(TAG, "Hintergrund: " + background + " Ausführungen in 20 s");
            assertTrue("Im Hintergrund nur " + background + " Ausführungen in 20 s (erwartet ≥ 8)", background >= 8);

            String log = js(scenario, "MS.store.state.log.filter(function (e) { return e.source === 'Intervall-Test' && e.msg.indexOf('Makro gestartet') === 0; }).length");
            Log.i(TAG, "Protokolleinträge „Makro gestartet“: " + log);
        }
    }
}
