package de.d4rroy.makrostudio;

import android.graphics.Bitmap;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/** Texterkennung mit ML Kit (Modell kommt über die Google-Play-Dienste, die APK bleibt klein). */
final class TextOcr {
    interface Callback {
        void done(String text, String error);
    }

    private static TextRecognizer recognizer;

    private TextOcr() {
    }

    static synchronized void recognize(Bitmap bmp, Callback cb) {
        try {
            if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            recognizer.process(InputImage.fromBitmap(bmp, 0))
                    .addOnSuccessListener(r -> cb.done(r.getText(), null))
                    .addOnFailureListener(e -> cb.done(null, "Texterkennung: " + e.getMessage()
                            + " (benötigt die Google-Play-Dienste; beim ersten Mal wird das Modell geladen)"));
        } catch (RuntimeException | LinkageError e) {
            cb.done(null, "Texterkennung nicht verfügbar: " + e.getMessage());
        }
    }
}
