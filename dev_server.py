"""Modo de desenvolvimento: sobe só o servidor (sem janela) para abrir a interface no navegador."""
import time
from gamevault.api import Api
from gamevault.library import Library
from gamevault.server import make_server

lib = Library()
api = Api(lib)
srv = make_server(lib, api)
print(f"http://127.0.0.1:{srv.server_address[1]}/index.html?t={srv.token}", flush=True)
lib.start()
while True:
    time.sleep(3600)
