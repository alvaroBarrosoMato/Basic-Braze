"""Vercel Python function: every /api/* request is rewritten here (see vercel.json)."""
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))
import _shop  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _run(self, method):
        url = urlparse(self.path)
        # vercel.json rewrites /api/<path> -> /api/index?path=<path>
        rewritten = parse_qs(url.query).get("path")
        path = f"/api/{rewritten[0]}" if rewritten else url.path
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""

        status, headers, payload = _shop.handle(method, path, body)
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._run("GET")

    def do_POST(self):
        self._run("POST")
