package de.d4rroy.makrostudio;

import android.util.Base64;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** Minimaler SMTP-Versand (SSL/TLS oder STARTTLS, Anmeldung mit AUTH LOGIN) für die Aktion „E-Mail senden“. */
final class SmtpClient {
    private Socket socket;
    private BufferedReader in;
    private OutputStream out;

    private SmtpClient() {
    }

    /** Sendet eine Text-E-Mail. Gibt "" oder eine Fehlermeldung zurück. */
    static String send(String host, int port, String security, String user, String password,
                       String from, String to, String subject, String body) {
        from = from.replaceAll("[\\r\\n]", " ");
        to = to.replaceAll("[\\r\\n]", " ");
        SmtpClient c = new SmtpClient();
        try {
            c.connect(host, port, "ssl".equals(security));
            c.expect(220);
            c.ehlo();
            if ("starttls".equals(security)) {
                c.command("STARTTLS", 220);
                c.upgrade(host, port);
                c.ehlo();
            } else if (!"ssl".equals(security)) {
                return "Nur verschlüsselte Verbindungen (SSL/TLS oder STARTTLS) sind erlaubt";
            }
            if (!user.isEmpty()) {
                c.command("AUTH LOGIN", 334);
                c.command(b64(user), 334);
                c.command(b64(password), 235);
            }
            c.command("MAIL FROM:<" + addr(from) + ">", 250);
            String[] rcpts = to.split("[,;]");
            for (String r : rcpts) if (!r.trim().isEmpty()) c.command("RCPT TO:<" + addr(r.trim()) + ">", 250);
            c.command("DATA", 354);
            String date = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US).format(new Date());
            StringBuilder msg = new StringBuilder()
                    .append("From: ").append(from).append("\r\n")
                    .append("To: ").append(to).append("\r\n")
                    .append("Subject: =?UTF-8?B?").append(b64(subject)).append("?=\r\n")
                    .append("Date: ").append(date).append("\r\n")
                    .append("MIME-Version: 1.0\r\n")
                    .append("Content-Type: text/plain; charset=UTF-8\r\n")
                    .append("Content-Transfer-Encoding: base64\r\n\r\n");
            String encoded = Base64.encodeToString(body.getBytes(StandardCharsets.UTF_8), Base64.DEFAULT);
            msg.append(encoded.replace("\n", "\r\n")).append("\r\n.");
            c.command(msg.toString(), 250);
            c.command("QUIT", 221);
            return "";
        } catch (IOException e) {
            return "E-Mail: " + e.getMessage();
        } finally {
            c.close();
        }
    }

    private static String addr(String s) {
        int a = s.indexOf('<'), b = s.indexOf('>');
        String v = a >= 0 && b > a ? s.substring(a + 1, b) : s;
        return v.replaceAll("[\\r\\n<>]", "").trim();
    }

    private static String b64(String s) {
        return Base64.encodeToString(s.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private void connect(String host, int port, boolean ssl) throws IOException {
        Socket plain = new Socket();
        plain.connect(new InetSocketAddress(host, port), 15_000);
        plain.setSoTimeout(30_000);
        socket = plain;
        if (ssl) upgrade(host, port);
        else streams();
    }

    /** Verschlüsselt die Verbindung und prüft das Zertifikat inkl. Hostname. */
    private void upgrade(String host, int port) throws IOException {
        SSLSocketFactory f = (SSLSocketFactory) SSLSocketFactory.getDefault();
        SSLSocket s = (SSLSocket) f.createSocket(socket, host, port, true);
        SSLParameters p = s.getSSLParameters();
        p.setEndpointIdentificationAlgorithm("HTTPS");
        s.setSSLParameters(p);
        s.startHandshake();
        socket = s;
        streams();
    }

    private void streams() throws IOException {
        in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        out = socket.getOutputStream();
    }

    private void ehlo() throws IOException {
        command("EHLO makrostudio", 250);
    }

    private void command(String line, int expected) throws IOException {
        out.write((line + "\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
        expect(expected);
    }

    private void expect(int code) throws IOException {
        String line;
        do {
            line = in.readLine();
            if (line == null) throw new IOException("Verbindung vom Server getrennt");
        } while (line.length() > 3 && line.charAt(3) == '-');
        int got;
        try {
            got = Integer.parseInt(line.substring(0, 3));
        } catch (RuntimeException e) {
            throw new IOException("Ungültige Antwort: " + line);
        }
        if (got != code) throw new IOException("Server antwortet: " + line);
    }

    private void close() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
            // egal
        }
    }
}
