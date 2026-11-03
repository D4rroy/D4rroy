package de.d4rroy.makrostudio;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Prüft den Hintergrunddienst: Ist er eingeschaltet, läuft ein Intervall-Makro weiter,
 * auch nachdem die App (Activity) komplett geschlossen wurde.
 */
@RunWith(AndroidJUnit4.class)
public class BackgroundServiceTest {
    private static final String TAG = "BackgroundServiceTest";

    private static String js(String code) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            EngineHost host = EngineHost.peek();
            assertNotNull("Engine läuft nicht mehr", host);
            WebView web = host.webView();
            web.evaluateJavascript(code, v -> {
                result.set(v);
                done.countDown();
            });
        });
        assertTrue("JavaScript hat nicht geantwortet: " + code, done.await(20, TimeUnit.SECONDS));
        return result.get();
    }

    @Test
    public void macrosKeepRunningAfterAppIsClosed() throws Exception {
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        long until = SystemClock.uptimeMillis() + 30000;
        while (!"true".equals(js("!!(window.MS && MS.engine && MS.native && MS.native.available)"))) {
            assertTrue("App wurde nicht geladen", SystemClock.uptimeMillis() < until);
            SystemClock.sleep(500);
        }

        // Berechtigungsstatus lesbar?
        // evaluateJavascript liefert den String JSON-kodiert zurück
        String raw = js("JSON.stringify(MS.native.permissions())");
        JSONObject perms = new JSONObject(new JSONObject("{\"v\":" + raw + "}").getString("v"));
        Log.i(TAG, "Berechtigungen: " + perms);
        assertTrue(perms.has("accessibility") && perms.has("notification_listener") && perms.has("battery"));

        js("(function () {"
                + "MS.store.state = MS.store.defaults();"
                + "MS.store.state.variables.push({ name: 'zaehler', type: 'integer', value: 0 });"
                + "var t = MS.catalog.create('trigger', 'interval'); t.params.value = 2; t.params.unit = 's';"
                + "var a = MS.catalog.create('action', 'set_variable'); a.params.var = 'g:zaehler'; a.params.op = 'inc'; a.params.amount = 1;"
                + "MS.store.state.macros.push({ id: 'bg', name: 'Dienst-Test', category: 'Allgemein', enabled: true,"
                + "  triggers: [t], actions: [a], constraints: [], constraintLogic: 'and', localVars: [] });"
                + "MS.store.changed('macros');"
                + "MS.native.setBackground('service', true); return true; })()");
        SystemClock.sleep(3000);
        assertTrue("Hintergrunddienst startet nicht", MacroService.running);

        // App komplett schließen (Activity wird zerstört)
        scenario.moveToState(Lifecycle.State.DESTROYED);
        scenario.close();
        int before = Integer.parseInt(js("MS.vars.get('g:zaehler')"));
        SystemClock.sleep(20000);
        int after = Integer.parseInt(js("MS.vars.get('g:zaehler')"));
        Log.i(TAG, "Nach dem Schließen der App: " + (after - before) + " Ausführungen in 20 s");
        assertTrue("Nach dem Schließen nur " + (after - before) + " Ausführungen in 20 s (erwartet ≥ 8)", after - before >= 8);

        // Dienst wieder ausschalten → Engine wird beendet
        js("MS.native.setBackground('service', false); true");
        SystemClock.sleep(3000);
        assertTrue("Dienst läuft noch", !MacroService.running);
        Log.i(TAG, "Dienst gestoppt, Engine beendet: " + (EngineHost.peek() == null));
    }
}
