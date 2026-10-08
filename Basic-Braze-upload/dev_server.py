"""Local dev server: static site + the same /api code that runs on Vercel.

    python3 dev_server.py                     # uses Databricks (credentials from .env)
    FAKE_DATABRICKS=1 python3 dev_server.py   # in-memory SQLite built from sql/*.sql, no Databricks needed

Then open http://localhost:8080
"""
import os
import sqlite3
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "api"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import _databricks as db  # noqa: E402
import _shop  # noqa: E402
from setup_databricks import load_dotenv, statements  # noqa: E402

PORT = int(os.environ.get("PORT", 8080))


def use_fake_databricks():
    """Replace db.execute with SQLite. Returns strings like the real API does."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    lock = threading.Lock()

    def to_sqlite(sql):
        return sql.replace("TIMESTAMP '", "'")  # SQLite has no TIMESTAMP '...' literal

    def execute(sql, params=None, catalog_schema=None):
        values = {}
        for k, v in (params or {}).items():
            if isinstance(v, bool):
                v = int(v)
            elif v is not None and not isinstance(v, (int, float, str)):
                v = str(v)  # Decimal, datetime
            values[k] = v
        with lock:
            cur = conn.execute(to_sqlite(sql), values)
            cols = [d[0] for d in cur.description or []]
            rows = cur.fetchall()
            conn.commit()
        return [dict(zip(cols, (None if x is None else str(x) for x in r))) for r in rows]

    for name in ("01_tables.sql", "02_seed_catalog.sql"):
        for stmt in statements(os.path.join(ROOT, "sql", name)):
            execute(stmt)
    db.execute = execute
    db.target = lambda: ("local", "sqlite")
    print("Using FAKE Databricks (in-memory SQLite) — data is lost when the server stops.")


class Handler(SimpleHTTPRequestHandler):
    def _api(self, method):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""
        status, headers, payload = _shop.handle(method, urlparse(self.path).path, body)
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("POST")
        self.send_error(405)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")  # always serve fresh JS while developing
        super().end_headers()


if __name__ == "__main__":
    load_dotenv()
    if os.environ.get("FAKE_DATABRICKS") == "1":
        use_fake_databricks()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=ROOT))
    print(f"Braze Test Shop on http://localhost:{PORT}")
    server.serve_forever()
