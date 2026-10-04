"""A real simulation descendant signals readiness and waits for test release."""
import json
import os
from pathlib import Path
import sys
import time

ready, release = map(Path, sys.argv[1:])
temporary = ready.with_suffix(".tmp")
temporary.write_text(json.dumps({
    "pid": os.getpid(),
    "parentPid": os.getppid(),
    "processGroupId": os.getpgrp(),
}))
os.replace(temporary, ready)

deadline = time.monotonic() + 45
while not release.is_file():
    if time.monotonic() >= deadline:
        raise TimeoutError("Simulation gate was never released by the test")
    time.sleep(0.02)
