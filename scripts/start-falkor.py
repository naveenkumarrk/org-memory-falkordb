"""Docker-free local option. Requires the official falkordblite package."""
import os
import signal
import threading
from pathlib import Path
from redislite.falkordb_client import FalkorDB

root = Path(os.environ.get('ORG_MEMORY_DEMO_HOME', '.demo')).resolve()
root.mkdir(parents=True, exist_ok=True)
port = os.environ.get('FALKORDB_PORT', '16379')
db = FalkorDB(str(root / 'falkor.db'), serverconfig={'port': port, 'bind': '127.0.0.1'})
stop = threading.Event()
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda *_: stop.set())
print(f'Embedded FalkorDB ready at 127.0.0.1:{port}', flush=True)
try:
    stop.wait()
finally:
    db.connection.save()
    db.close()
