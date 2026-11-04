package de.d4rroy.makrostudio;

import android.net.Uri;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Kleiner HTTP-Server im Gerät für den Auslöser „Webhook“. Aufruf z. B.:
 * http://<handy-ip>:<port>/<pfad>?token=<token>&wert=1 – jede Anfrage braucht das Token.
 */
final class WebhookServer {
    private static final int MAX_BODY = 64 * 1024;
    private final EngineHost host;
    private final int port;
    private final String token;
    private volatile ServerSocket server;

    WebhookServer(EngineHost host, int port, String token) {
        this.host = host;
        this.port = port;
        this.token = token;
    }

    void start() {
        Thread t = new Thread(() -> {
            try (ServerSocket s = new ServerSocket(port)) {
                server = s;
                while (!s.isClosed()) {
                    Socket c = s.accept();
                    new Thread(() -> handle(c), "Webhook-Anfrage").start();
                }
            } catch (IOException e) {
                if (server != null && !server.isClosed()) {
                    host.event("webhook_error", SystemMonitor.obj("error", "Port " + port + ": " + e.getMessage()));
                }
            }
        }, "Webhook-Server");
        t.setDaemon(true);
        t.start();
    }

    void stop() {
        ServerSocket s = server;
        server = null;
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
                // bereits geschlossen
            }
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0 && c != '\n') {
            if (b.size() > 8192) throw new IOException("Zeile zu lang");
            if (c != '\r') b.write(c);
        }
        return c < 0 && b.size() == 0 ? null : b.toString("UTF-8");
    }

    private static boolean sameToken(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private void handle(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(10_000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String line = readLine(in);
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) {
                reply(sock, 400, "{\"ok\":false,\"error\":\"Ungültige Anfrage\"}");
                return;
            }
            String method = parts[0];
            Uri uri = Uri.parse("http://localhost" + parts[1]);
            int length = 0;
            String headerToken = "";
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                int i = h.indexOf(':');
                if (i <= 0) continue;
                String k = h.substring(0, i).trim().toLowerCase(java.util.Locale.ROOT);
                String v = h.substring(i + 1).trim();
                if (k.equals("content-length")) length = Math.min(MAX_BODY, Math.max(0, Integer.parseInt(v)));
                else if (k.equals("x-token")) headerToken = v;
            }
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int r = in.read(body, read, length - read);
                if (r < 0) break;
                read += r;
            }
            String given = uri.getQueryParameter("token");
            if (given == null) given = headerToken;
            if (token.isEmpty() || !sameToken(token, given)) {
                reply(sock, 403, "{\"ok\":false,\"error\":\"Token fehlt oder ist falsch\"}");
                return;
            }
            JSONObject query = new JSONObject();
            for (String k : uri.getQueryParameterNames()) if (!k.equals("token")) query.put(k, uri.getQueryParameter(k));
            String path = uri.getPath() == null ? "/" : uri.getPath();
            host.event("webhook", new JSONObject()
                    .put("method", method)
                    .put("path", path.replaceAll("^/+", ""))
                    .put("query", query)
                    .put("body", new String(body, 0, read, StandardCharsets.UTF_8))
                    .put("from", sock.getInetAddress().getHostAddress()));
            reply(sock, 200, "{\"ok\":true}");
        } catch (IOException | RuntimeException | JSONException e) {
            // Verbindung abgebrochen oder fehlerhafte Anfrage – ignorieren
        }
    }

    private static void reply(Socket s, int code, String json) throws IOException {
        byte[] b = json.getBytes(StandardCharsets.UTF_8);
        String status = code == 200 ? "OK" : code == 403 ? "Forbidden" : "Bad Request";
        OutputStream out = s.getOutputStream();
        out.write(("HTTP/1.1 " + code + " " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + b.length
                + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }
}
