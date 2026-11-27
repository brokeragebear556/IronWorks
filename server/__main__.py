"""Start Ironworks:  python -m server"""
import logging
import os
import socket
import sys

import uvicorn

from .config import HOST, PORT


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if os.name != "nt":
            # Linux/macOS: ignore sockets left in TIME_WAIT by a server that just stopped (this still
            # fails if another server is listening). Not on Windows, where it would let two servers share the port.
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def main():
    if sys.version_info < (3, 10):
        sys.exit("Ironworks needs Python 3.10 or newer.")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    from . import access
    # This computer only, unless network access is on (Settings -> Network) or WB_HOST says otherwise.
    host = os.environ.get("WB_HOST") or ("0.0.0.0" if access.lan_enabled() else HOST)
    if not port_free(host, PORT):
        print(f"Port {PORT} is already in use. Ironworks is probably already running:")
        print(f"open http://127.0.0.1:{PORT}  or close the other server window first.")
        sys.exit(1)
    os.environ[access.BOUND_HOST_ENV] = host
    print(f"Ironworks: http://127.0.0.1:{PORT}  (Ctrl+C to stop)", flush=True)
    if host != HOST:
        for a in access.local_addresses():
            print(f"  on your network: http://{a}:{PORT}  (other devices sign in with your password)", flush=True)
    uvicorn.run("server.app:app", host=host, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
