package de.d4rroy.makrostudio;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.WebView;

/** Zeigt die Makro-Engine aus {@link EngineHost} an. */
public class MainActivity extends Activity {
    private EngineHost host;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        host = EngineHost.get(this);
        host.attach(this);
        if (Prefs.get(this).getBoolean(Prefs.SERVICE, false)) MacroService.start(this);
    }

    /** Für Tests: die WebView mit der App. */
    WebView getWebView() {
        return host.webView();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Nach der Rückkehr aus den Android-Einstellungen den Berechtigungsstatus neu anzeigen
        host.eval("window.MS&&MS.bus&&MS.bus.emit('app-resume')");
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Erst Dialoge schließen bzw. in der App zurückgehen; auf der Startseite in den
        // Hintergrund wechseln statt zu beenden, damit die Makros weiterlaufen.
        host.webView().evaluateJavascript("!!(window.MS && MS.app && MS.app.handleBack())", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        host.onActivityResult(requestCode, resultCode, data);
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        boolean granted = false;
        for (int r : grantResults) granted |= r == PackageManager.PERMISSION_GRANTED;
        host.onPermissionResult(requestCode, granted);
    }

    @Override
    protected void onDestroy() {
        host.detach(this);
        super.onDestroy();
    }
}
