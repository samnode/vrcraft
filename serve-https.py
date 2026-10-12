#!/usr/bin/env python3
"""Serve this folder over HTTPS so a Quest on the same Wi-Fi can load it.

WebXR only runs in a secure context. http://localhost counts as one, but a plain
http:// LAN address does not, so reaching the headset over Wi-Fi needs TLS. This
generates a self-signed certificate on first run; the browser will warn once and
you accept it manually.

    python3 serve-https.py [port]

Prefer `adb reverse` (see README) if you have a USB cable: it avoids the warning.
"""

import http.server
import os
import ssl
import subprocess
import sys
import socket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
ROOT = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(ROOT, ".devcert.pem")


def ensure_cert():
    if os.path.exists(CERT):
        return
    print("Generating a self-signed certificate (.devcert.pem)...")
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
         "-keyout", CERT, "-out", CERT, "-days", "825",
         "-subj", "/CN=vrcraft.local"],
        check=True, capture_output=True,
    )


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


ensure_cert()
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(CERT)

httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

print(f"VRCraft serving on https://{lan_ip()}:{PORT}")
print("Open that address in the Meta Quest Browser and accept the warning.")
httpd.serve_forever()
