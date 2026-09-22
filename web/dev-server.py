#!/usr/bin/env python3
"""
Dev server for Support Fins -- serves web/ with caching turned OFF.

WHY THIS EXISTS: the app is vanilla ES modules loaded with static imports. Python's
plain `http.server` sends no Cache-Control header, so Chrome applies HEURISTIC caching
and will serve a STALE prop.js / fins.js on an ordinary reload -- you edit the engine,
reload, and see the OLD geometry, with no hint anything is wrong. That has burned us
repeatedly ("kill the app and restart"). This server sends `Cache-Control: no-store`
on everything, so every reload fetches the current file. No hard-reload needed.

    cd ~/projects/support-fins/web && python3 dev-server.py        # -> http://localhost:8731
    python3 dev-server.py 8080                                     # custom port
    python3 dev-server.py --host 0.0.0.0                           # reach from other devices on the LAN
"""
import argparse
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


def _lan_ip():
    """Best-effort LAN address for the "reachable at" hint. No packets are sent."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # pick a route; the OS resolves the local end without sending
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Support Fins no-cache dev server.",
        epilog="Bind 0.0.0.0 (or ::) to reach the server from other devices on your LAN.",
    )
    parser.add_argument("port", nargs="?", type=int, default=8731,
                        help="port to listen on (default: 8731)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="address to bind (default: 127.0.0.1; 0.0.0.0 exposes it to the LAN)")
    args = parser.parse_args()

    # Serves the current working directory -- run it from inside web/:
    #   cd ~/projects/support-fins/web && python3 dev-server.py
    wildcard = args.host in ("0.0.0.0", "::", "")
    bind = "" if wildcard else args.host
    print(f"Support Fins dev server (no-cache) -> http://localhost:{args.port}")
    if wildcard:
        ip = _lan_ip()
        if ip:
            print(f"On other devices on your LAN, open http://{ip}:{args.port}")
    print("Every reload fetches fresh JS -- no hard-reload needed. Ctrl-C to stop.")
    sys.stdout.flush()  # ensure the lines above land in a redirected log immediately (e.g. headless RPi)
    ThreadingHTTPServer((bind, args.port), NoCacheHandler).serve_forever()
