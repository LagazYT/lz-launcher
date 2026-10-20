"""Servidor HTTP local (127.0.0.1) que entrega a interface e as imagens das capas."""
import json
import mimetypes
import os
import secrets
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

from .paths import UI_DIR


def make_server(library, api=None):
    token = secrets.token_urlsafe(16)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _file(self, path, cache=True):
            if not path or not os.path.isfile(path):
                self.send_error(404)
                return
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            try:
                with open(path, "rb") as f:
                    data = f.read()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=31536000" if cache else "no-cache")
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            # API local usada quando a interface roda fora da janela do app (ex.: navegador)
            parts = [p for p in urlparse(self.path).path.split("/") if p]
            if api is None or len(parts) != 2 or parts[0] != "api" or parts[1].startswith("_")                     or self.headers.get("X-Token") != token:
                return self.send_error(403)
            fn = getattr(api, parts[1], None)
            if not callable(fn):
                return self.send_error(404)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                args = json.loads(self.rfile.read(n) or b"[]")
                result = fn(*args)
                body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            parts = [unquote(p) for p in url.path.split("/") if p]
            if parts[:1] == ["img"] and len(parts) == 3:
                return self._file(library.image_path(parts[1], parts[2]))
            if parts[:1] == ["local"] and len(parts) == 2:
                return self._file(library.local_from_token(parts[1]))
            rel = "/".join(parts) or "index.html"
            full = os.path.normpath(os.path.join(UI_DIR, rel))
            if not full.startswith(os.path.normpath(str(UI_DIR))):
                return self.send_error(403)
            return self._file(full, cache=False)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.token = token
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
