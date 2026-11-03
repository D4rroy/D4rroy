// Makro Studio – lokaler HTTPS-Server fürs Handy.
//
// Erzeugt beim ersten Start eine eigene Zertifizierungsstelle (CA) in .certs/
// und bei jedem Start ein Serverzertifikat für localhost und alle aktuellen
// WLAN/LAN-Adressen. Das Handy installiert einmalig das CA-Zertifikat und
// vertraut dann der App unter https://<IP-Adresse>:8443.
//
//   npm install
//   npm run https            (Ports: HTTPS_PORT=8443, SETUP_PORT=8080)

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT_DIR = path.join(ROOT, '.certs');
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const SETUP_PORT = Number(process.env.SETUP_PORT) || 8080;
const CA_NAME = 'Makro Studio lokale CA';

// ------------------------------------------------------------ Zertifikate
function lanAddresses() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
  return ips;
}

function newCert(publicKey, years) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600e3);
  cert.validity.notAfter = new Date(Date.now() + years * 365 * 24 * 3600e3);
  return cert;
}

function loadOrCreateCA() {
  const keyFile = path.join(CERT_DIR, 'ca.key'), certFile = path.join(CERT_DIR, 'ca.crt');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return {
      key: forge.pki.privateKeyFromPem(fs.readFileSync(keyFile, 'utf8')),
      cert: forge.pki.certificateFromPem(fs.readFileSync(certFile, 'utf8')),
    };
  }
  console.log('Erzeuge lokale Zertifizierungsstelle (einmalig) …');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = newCert(keys.publicKey, 10);
  const attrs = [{ name: 'commonName', value: CA_NAME }, { name: 'organizationName', value: 'Makro Studio (lokal)' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyFile, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
  fs.writeFileSync(certFile, forge.pki.certificateToPem(cert));
  return { key: keys.privateKey, cert };
}

function createServerCert(ca, ips) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  // Apple akzeptiert Serverzertifikate mit höchstens 825 Tagen Laufzeit
  const cert = newCert(keys.publicKey, 1);
  cert.setSubject([{ name: 'commonName', value: ips[0] || 'localhost' }]);
  cert.setIssuer(ca.cert.subject.attributes);
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 2, value: os.hostname() },
    { type: 2, value: os.hostname() + '.local' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'authorityKeyIdentifier', keyIdentifier: ca.cert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
}

// ---------------------------------------------------------- Dateiserver
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  let file = path.normalize(path.join(ROOT, urlPath));
  const rel = path.relative(ROOT, file);
  // Nur App-Dateien ausliefern – keine Zertifikate, Werkzeuge oder Abhängigkeiten
  if (rel.startsWith('..') || /^(\.|node_modules|tools)/.test(rel.split(path.sep)[0])) {
    res.writeHead(404).end('Nicht gefunden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function setupPage(ips) {
  const appUrls = ips.map((ip) => `https://${ip}:${HTTPS_PORT}`);
  const links = appUrls.map((u) => `<li><a href="${u}">${u}</a></li>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Makro Studio einrichten</title>
<style>
  :root { --bg: #eef1f5; --card: #fff; --text: #17202b; --muted: #5a6574; --accent: #2f7de1; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e141b; --card: #17202a; --text: #e7ecf2; --muted: #9aa7b6; --accent: #4b92f0; color-scheme: dark; } }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--text); }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  section { background: var(--card); border-radius: 14px; padding: 16px 18px; margin: 14px 0; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 0 0 8px; }
  p, li { color: var(--muted); } a { color: var(--accent); word-break: break-all; }
  .btn { display: inline-block; padding: 12px 20px; border-radius: 99px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
  ol { padding-left: 20px; } strong { color: var(--text); }
</style></head><body><main>
<h1>Makro Studio einrichten</h1>
<p>Einmalig das Zertifikat auf dem Handy installieren, danach läuft die App über HTTPS mit allen Funktionen.</p>
<section><h2>1. Zertifikat herunterladen</h2>
<p><a class="btn" href="/makro-studio-ca.crt">Zertifikat herunterladen</a></p></section>
<section><h2>2a. Android installieren</h2><ol>
<li><strong>Einstellungen → Sicherheit &amp; Datenschutz → Weitere Sicherheitseinstellungen → Verschlüsselung &amp; Anmeldedaten → Zertifikat installieren → CA-Zertifikat</strong> (je nach Hersteller leicht anders benannt; in den Einstellungen nach „Zertifikat“ suchen).</li>
<li>Die heruntergeladene Datei <strong>makro-studio-ca.crt</strong> auswählen und die Warnung bestätigen.</li>
<li>Chrome einmal komplett schließen und neu öffnen.</li></ol></section>
<section><h2>2b. iPhone/iPad installieren</h2><ol>
<li>Den Link oben in <strong>Safari</strong> öffnen und „Zulassen“ tippen.</li>
<li><strong>Einstellungen → Profil geladen → Installieren</strong>.</li>
<li><strong>Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen</strong> → „${CA_NAME}“ aktivieren.</li></ol></section>
<section><h2>3. App öffnen</h2><ul>${links}</ul>
<p>Danach im Browser-Menü <strong>„App installieren“</strong> bzw. <strong>„Zum Home-Bildschirm“</strong> wählen.</p></section>
</main></body></html>`;
}

// ---------------------------------------------------------------- Start
const ips = lanAddresses();
const ca = loadOrCreateCA();
const serverCert = createServerCert(ca, ips);
const caPem = forge.pki.certificateToPem(ca.cert);

https.createServer(serverCert, serveStatic).listen(HTTPS_PORT, '0.0.0.0');

http.createServer((req, res) => {
  if (req.url.startsWith('/makro-studio-ca.crt')) {
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="makro-studio-ca.crt"' });
    res.end(caPem);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(setupPage(ips));
}).listen(SETUP_PORT, '0.0.0.0');

console.log(`
Makro Studio läuft mit HTTPS.

  Auf diesem Rechner:   https://localhost:${HTTPS_PORT}
${ips.map((ip) => `  Handy (gleiches WLAN): https://${ip}:${HTTPS_PORT}`).join('\n') || '  (Keine WLAN/LAN-Adresse gefunden)'}

Einmalige Einrichtung am Handy – diese Seite öffnen und den Schritten folgen:
${ips.map((ip) => `  http://${ip}:${SETUP_PORT}`).join('\n')}

Beenden mit Strg+C.`);
