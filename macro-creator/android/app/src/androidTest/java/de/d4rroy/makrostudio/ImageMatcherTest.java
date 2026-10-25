package de.d4rroy.makrostudio;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Random;

/** Prüft die Bildsuche („Bild auf dem Bildschirm suchen“) mit einem künstlichen Bildschirm. */
@RunWith(AndroidJUnit4.class)
public class ImageMatcherTest {
    private static Bitmap screen() {
        Bitmap b = Bitmap.createBitmap(1080, 2400, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.drawColor(Color.rgb(30, 40, 60));
        Random rnd = new Random(42);
        Paint p = new Paint();
        for (int i = 0; i < 400; i++) {
            p.setColor(Color.rgb(rnd.nextInt(256), rnd.nextInt(256), rnd.nextInt(256)));
            int x = rnd.nextInt(1080), y = rnd.nextInt(2400);
            c.drawRect(x, y, x + 20 + rnd.nextInt(80), y + 20 + rnd.nextInt(80), p);
        }
        // „Truhe“: markantes Muster an bekannter Stelle
        p.setColor(Color.rgb(230, 180, 40));
        c.drawRect(880, 1620, 1000, 1720, p);
        p.setColor(Color.rgb(120, 60, 10));
        c.drawRect(880, 1660, 1000, 1675, p);
        c.drawCircle(940, 1690, 12, p);
        return b;
    }

    @Test
    public void findsTemplateInRegionAndFullScreen() {
        Bitmap s = screen();
        Bitmap chest = Bitmap.createBitmap(s, 870, 1610, 140, 120);

        long t0 = System.currentTimeMillis();
        ImageMatcher.Result inRegion = ImageMatcher.find(s, chest, new int[] { 780, 1200, 280, 900 }, 0.9);
        long t1 = System.currentTimeMillis();
        ImageMatcher.Result full = ImageMatcher.find(s, chest, null, 0.9);
        long t2 = System.currentTimeMillis();
        Log.i("ImageMatcherTest", "Bereich: " + inRegion.score + " bei " + inRegion.startX + "," + inRegion.startY + " in " + (t1 - t0) + " ms; ganzer Bildschirm: " + full.score + " bei " + full.startX + "," + full.startY + " in " + (t2 - t1) + " ms");

        assertTrue(inRegion.found);
        assertEquals(870, inRegion.startX, 3);
        assertEquals(1610, inRegion.startY, 3);
        assertTrue(full.found);
        assertEquals(870, full.startX, 3);
        assertEquals(1610, full.startY, 3);
        assertTrue("Suche zu langsam: " + (t2 - t1) + " ms", t2 - t1 < 5000);
    }

    @Test
    public void reportsNotFoundForOtherImage() {
        Bitmap s = screen();
        Bitmap other = Bitmap.createBitmap(140, 120, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(other);
        c.drawColor(Color.WHITE);
        Paint p = new Paint();
        p.setColor(Color.MAGENTA);
        c.drawCircle(70, 60, 40, p);
        p.setColor(Color.GREEN);
        c.drawRect(10, 10, 50, 30, p);
        ImageMatcher.Result r = ImageMatcher.find(s, other, new int[] { 780, 1200, 280, 900 }, 0.9);
        Log.i("ImageMatcherTest", "Fremdes Bild: " + r.score);
        assertFalse(r.found);
    }
}
