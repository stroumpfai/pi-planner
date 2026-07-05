"""Sliding-window rate limiting for login attempts.

Two buckets guard the login endpoint:
  - per ip:username — stops brute-forcing one account (tight limit)
  - per ip          — stops one address spraying many usernames (loose limit)

Buckets are pruned on every access and the whole map is swept once it grows
past a threshold, so an attacker cannot grow memory unboundedly by cycling
through unique usernames.
"""

import time

_MAX_ATTEMPTS = 5          # per ip:username
_MAX_ATTEMPTS_PER_IP = 20  # per ip, across all usernames
_WINDOW_SECONDS = 300      # 5 minutes
_SWEEP_THRESHOLD = 1000    # full sweep when the map grows past this many keys

_failures: dict[str, list[float]] = {}


def _recent(key: str, now: float) -> list[float]:
    """Prune *key*'s bucket to the current window; drop the key when empty."""
    cutoff = now - _WINDOW_SECONDS
    active = [t for t in _failures.get(key, []) if t > cutoff]
    if active:
        _failures[key] = active
    else:
        _failures.pop(key, None)
    return active


def _sweep(now: float) -> None:
    cutoff = now - _WINDOW_SECONDS
    stale = [key for key, times in _failures.items() if not any(t > cutoff for t in times)]
    for key in stale:
        del _failures[key]


def is_rate_limited(ip: str, username: str) -> bool:
    now = time.time()
    if len(_recent(f"{ip}:{username.lower()}", now)) >= _MAX_ATTEMPTS:
        return True
    return len(_recent(f"ip:{ip}", now)) >= _MAX_ATTEMPTS_PER_IP


def record_failure(ip: str, username: str) -> None:
    now = time.time()
    if len(_failures) > _SWEEP_THRESHOLD:
        _sweep(now)
    _failures.setdefault(f"{ip}:{username.lower()}", []).append(now)
    _failures.setdefault(f"ip:{ip}", []).append(now)


def clear_failures(ip: str, username: str) -> None:
    """On successful login, forgive the account bucket (not the whole IP)."""
    _failures.pop(f"{ip}:{username.lower()}", None)
