package de.d4rroy.makrostudio;

import android.graphics.drawable.Icon;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Schnelleinstellungs-Kacheln 1–3: ein Tippen löst den Auslöser „Schnelleinstellungs-Kachel“ aus. */
abstract class TileBase extends TileService {
    abstract int number();

    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        String label = Prefs.get(this).getString("tile_label_" + number(), "");
        t.setLabel(label.isEmpty() ? "Makro " + number() : label);
        t.setIcon(Icon.createWithResource(this, R.drawable.ic_notification));
        t.setState(label.isEmpty() ? Tile.STATE_INACTIVE : Tile.STATE_ACTIVE);
        t.updateTile();
    }

    @Override
    public void onClick() {
        EngineHost host = EngineHost.get(this);
        host.ensure();
        MacroService.startIfEnabled(this);
        host.event("tile", SystemMonitor.obj("tile", number()));
    }
}
