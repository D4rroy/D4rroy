package de.d4rroy.makrostudio;

import android.graphics.Bitmap;

/**
 * Sucht ein Vergleichsbild in einem Screenshot (normierte Kreuzkorrelation auf
 * Graustufen). Beide Bilder werden verkleinert, damit die Suche schnell bleibt;
 * die Fundstelle wird danach in voller Auflösung verfeinert.
 */
final class ImageMatcher {
    static final class Result {
        boolean found;
        int startX, startY, endX, endY;
        double score;
    }

    private ImageMatcher() {
    }

    private static float[] gray(Bitmap b, int x0, int y0, int w, int h, int step) {
        int ow = w / step, oh = h / step;
        float[] out = new float[ow * oh];
        int[] row = new int[w];
        for (int y = 0; y < oh; y++) {
            b.getPixels(row, 0, w, x0, y0 + y * step, w, 1);
            for (int x = 0; x < ow; x++) {
                int c = row[x * step];
                out[y * ow + x] = 0.299f * ((c >> 16) & 255) + 0.587f * ((c >> 8) & 255) + 0.114f * (c & 255);
            }
        }
        return out;
    }

    /** Bester NCC-Wert einer Position und dessen Koordinaten im (verkleinerten) Suchbild. */
    private static double[] search(float[] s, int sw, int sh, float[] t, int tw, int th, int fromX, int toX, int fromY, int toY) {
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
        double best = -2;
        int bx = 0, by = 0;
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
                if (score > best) {
                    best = score;
                    bx = x;
                    by = y;
                }
            }
        }
        return new double[] { best, bx, by };
    }

    /**
     * @param region {x, y, w, h} in Pixeln oder null für den ganzen Bildschirm
     * @param threshold Mindestübereinstimmung 0..1
     */
    static Result find(Bitmap screen, Bitmap template, int[] region, double threshold) {
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
        double[] coarse = search(s, sw, sh, t, stw, sth, 0, sw, 0, sh);
        int cx = (int) coarse[1] * step, cy = (int) coarse[2] * step;
        double score = coarse[0];
        if (step > 1) {
            // Verfeinern in voller Auflösung rund um den Treffer
            int margin = step * 2;
            int fx = Math.max(0, cx - margin), fy = Math.max(0, cy - margin);
            int fw = Math.min(rw - fx, tw + 2 * margin), fh = Math.min(rh - fy, th + 2 * margin);
            int fine = Math.max(1, Math.min(tw, th) / 64);
            float[] s2 = gray(screen, rx + fx, ry + fy, (fw / fine) * fine, (fh / fine) * fine, fine);
            float[] t2 = gray(template, 0, 0, (tw / fine) * fine, (th / fine) * fine, fine);
            double[] f = search(s2, fw / fine, fh / fine, t2, tw / fine, th / fine, 0, fw, 0, fh);
            if (f[0] >= score - 0.05) {
                score = f[0];
                cx = fx + (int) f[1] * fine;
                cy = fy + (int) f[2] * fine;
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
