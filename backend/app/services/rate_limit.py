import time
from collections import defaultdict

_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 300  # 5 minutes

_failures: dict[str, list[float]] = defaultdict(list)


def is_rate_limited(key: str) -> bool:
    now = time.time()
    cutoff = now - _WINDOW_SECONDS
    active = [t for t in _failures[key] if t > cutoff]
    _failures[key] = active
    return len(active) >= _MAX_ATTEMPTS


def record_failure(key: str) -> None:
    _failures[key].append(time.time())


def clear_failures(key: str) -> None:
    _failures.pop(key, None)
