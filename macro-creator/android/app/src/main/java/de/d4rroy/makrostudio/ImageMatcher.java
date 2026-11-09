package de.d4rroy.makrostudio;

import android.graphics.Bitmap;

/**
 * Sucht ein Vergleichsbild in einem Screenshot (normierte Kreuzkorrelation auf
 * Graustufen). Beide Bilder werden durch Mittelwertbildung verkleinert, damit die Suche
 * schnell bleibt; die besten Kandidaten werden danach in voller Auflösung geprüft.
 */
final class ImageMatcher {
    static final class Result {
        boolean found;
        int startX, startY, endX, endY;
        double score;
        /** Größenfaktor, mit dem das Vergleichsbild gefunden wurde (1 = Originalgröße). */
        double scale = 1;
    }

    private ImageMatcher() {
    }

    /**
     * Graustufen, um den Faktor step verkleinert. Jeder Zielpixel ist der Mittelwert seines
     * step×step-Blocks – so bleibt Pixel-Art erkennbar, egal wo sie relativ zum Raster liegt
     * (nur jeden step-ten Pixel zu lesen erzeugt sonst je nach Lage ein völlig anderes Bild).
     */
    private static float[] gray(Bitmap b, int x0, int y0, int w, int h, int step) {
        int ow = w / step, oh = h / step;
        float[] out = new float[ow * oh];
        int[] row = new int[ow * step];
        float norm = 1f / (step * step);
        for (int y = 0; y < oh; y++) {
            for (int dy = 0; dy < step; dy++) {
                b.getPixels(row, 0, ow * step, x0, y0 + y * step + dy, ow * step, 1);
                for (int x = 0; x < ow; x++) {
                    float acc = 0;
                    for (int dx = 0; dx < step; dx++) {
                        int c = row[x * step + dx];
                        acc += 0.299f * ((c >> 16) & 255) + 0.587f * ((c >> 8) & 255) + 0.114f * (c & 255);
                    }
                    out[y * ow + x] += acc * norm;
                }
            }
        }
        return out;
    }

    /** NCC-Werte aller Positionen; liefert die besten Kandidaten (Wert, x, y), die sich nicht überlappen. */
    private static double[][] search(float[] s, int sw, int sh, float[] t, int tw, int th, int fromX, int toX, int fromY, int toY, int keep) {
        int n = tw * th;
        double tMean = 0;
        for (float v : t) tMean += v;
        tMean /= n;
        double tVar = 0;
        float[] tc = new float[n];
        for (int i = 0; i < n; i++) {
            tc[i] = (float) (t[i] - tMean);
            tVar += tc[i] * tc[i];
        }
        double[][] best = new double[keep][];
        for (int y = Math.max(0, fromY); y <= Math.min(sh - th, toY); y++) {
            for (int x = Math.max(0, fromX); x <= Math.min(sw - tw, toX); x++) {
                double sum = 0, sum2 = 0, cross = 0;
                for (int j = 0; j < th; j++) {
                    int so = (y + j) * sw + x, to = j * tw;
                    for (int i = 0; i < tw; i++) {
                        float v = s[so + i];
                        sum += v;
                        sum2 += v * v;
                        cross += v * tc[to + i];
                    }
                }
                double sVar = sum2 - sum * sum / n;
                double score = tVar <= 1e-6 || sVar <= 1e-6 ? (Math.abs(sum / n - tMean) < 8 ? 1 : 0) : cross / Math.sqrt(sVar * tVar);
                insert(best, score, x, y, Math.max(1, tw / 2), Math.max(1, th / 2));
            }
        }
        int k = 0;
        while (k < keep && best[k] != null) k++;
        return java.util.Arrays.copyOf(best, k);
    }

    /** Kandidatenliste (absteigend) pflegen; nahe beieinander liegende Treffer zählen nur einmal. */
    private static void insert(double[][] best, double score, int x, int y, int dx, int dy) {
        for (int i = 0; i < best.length; i++) {
            double[] b = best[i];
            if (b != null && Math.abs(b[1] - x) < dx && Math.abs(b[2] - y) < dy) {
                if (score <= b[0]) return;
                // besseren Wert für dieselbe Stelle: alten Eintrag entfernen
                System.arraycopy(best, i + 1, best, i, best.length - i - 1);
                best[best.length - 1] = null;
                break;
            }
        }
        for (int i = 0; i < best.length; i++) {
            if (best[i] == null || score > best[i][0]) {
                System.arraycopy(best, i, best, i + 1, best.length - i - 1);
                best[i] = new double[] { score, x, y };
                return;
            }
        }
    }

    /**
     * @param region {x, y, w, h} in Pixeln oder null für den ganzen Bildschirm
     * @param threshold Mindestübereinstimmung 0..1
     */
    /** Größenfaktoren für die zweite Runde, falls das Vergleichsbild aus einer anderen Auflösung stammt. */
    private static final double[] SCALES = { 0.9, 1.1, 0.8, 1.25, 0.75, 1.333, 0.667, 1.5, 0.5, 2.0 };

    static Result find(Bitmap screen, Bitmap template, int[] region, double threshold) {
        Result best = findAtScale(screen, template, region, threshold);
        if (best.found) return best;
        // Nicht gefunden: dieselbe Suche mit vergrößertem/verkleinertem Vergleichsbild
        for (double sc : SCALES) {
            int w = (int) Math.round(template.getWidth() * sc), h = (int) Math.round(template.getHeight() * sc);
            if (w < 8 || h < 8) continue;
            Result r = findAtScale(screen, Bitmap.createScaledBitmap(template, w, h, true), region, threshold);
            r.scale = sc;
            if (r.score > best.score) best = r;
            if (best.found) break;
        }
        return best;
    }

    private static Result findAtScale(Bitmap screen, Bitmap template, int[] region, double threshold) {
        Result r = new Result();
        int rx = 0, ry = 0, rw = screen.getWidth(), rh = screen.getHeight();
        if (region != null) {
            rx = Math.max(0, Math.min(region[0], rw - 1));
            ry = Math.max(0, Math.min(region[1], rh - 1));
            rw = Math.max(1, Math.min(region[2], screen.getWidth() - rx));
            rh = Math.max(1, Math.min(region[3], screen.getHeight() - ry));
        }
        int tw = template.getWidth(), th = template.getHeight();
        if (tw > rw || th > rh) return r;
        // Verkleinerung so wählen, dass das Vergleichsbild etwa 24–40 Pixel groß ist
        int step = Math.max(1, Math.min(tw, th) / 32);
        // Große Suchbereiche zusätzlich verkleinern, das Vergleichsbild bleibt aber mindestens 8 Pixel groß
        step = Math.max(step, (int) Math.ceil(Math.max(rw, rh) / 480.0));
        step = Math.max(1, Math.min(step, Math.min(tw, th) / 8));
        int sw = rw / step, sh = rh / step, stw = tw / step, sth = th / step;
        float[] s = gray(screen, rx, ry, sw * step, sh * step, step);
        float[] t = gray(template, 0, 0, stw * step, sth * step, step);
        // Grobsuche: die besten Kandidaten merken und jeden in voller Auflösung nachprüfen
        double[][] coarse = search(s, sw, sh, t, stw, sth, 0, sw, 0, sh, step > 1 ? 6 : 1);
        double score = -2;
        int cx = 0, cy = 0;
        int fine = Math.max(1, Math.min(tw, th) / 96);
        float[] t2 = step > 1 ? gray(template, 0, 0, (tw / fine) * fine, (th / fine) * fine, fine) : null;
        for (double[] c : coarse) {
            int px = (int) c[1] * step, py = (int) c[2] * step;
            if (step == 1) {
                if (c[0] > score) { score = c[0]; cx = px; cy = py; }
                continue;
            }
            int margin = step + 1;
            int fx = Math.max(0, px - margin), fy = Math.max(0, py - margin);
            int fw = Math.min(rw - fx, tw + 2 * margin), fh = Math.min(rh - fy, th + 2 * margin);
            float[] s2 = gray(screen, rx + fx, ry + fy, (fw / fine) * fine, (fh / fine) * fine, fine);
            double[][] f = search(s2, fw / fine, fh / fine, t2, tw / fine, th / fine, 0, fw, 0, fh, 1);
            if (f.length > 0 && f[0][0] > score) {
                score = f[0][0];
                cx = fx + (int) f[0][1] * fine;
                cy = fy + (int) f[0][2] * fine;
            }
        }
        r.score = score;
        r.found = score >= threshold;
        r.startX = rx + cx;
        r.startY = ry + cy;
        r.endX = r.startX + tw;
        r.endY = r.startY + th;
        return r;
    }
}
