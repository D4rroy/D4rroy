package de.d4rroy.makrostudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Unsichtbare Activity für Ereignisse von außen: NFC-Tags (makrostudio://nfc/…) und
 * Homescreen-Verknüpfungen (makrostudio://run/…). Meldet das Ereignis an die Engine und schließt sich.
 */
public class EventActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handle(getIntent());
        finish();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
        finish();
    }

    private void handle(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"makrostudio".equals(u.getScheme())) return;
        String id = u.getLastPathSegment() == null ? "" : u.getLastPathSegment();
        EngineHost host = EngineHost.get(this);
        host.ensure();
        MacroService.startIfEnabled(this);
        if ("nfc".equals(u.getHost())) host.event("nfc", SystemMonitor.obj("tag", id));
        else if ("run".equals(u.getHost())) host.event("shortcut", SystemMonitor.obj("id", id));
    }
}
