#!/usr/bin/env python3
"""Per-file coverage floors for the code that guards access.

pytest-cov can only gate a suite's total, and a total in the high 90s hides
one file at 50% — which is how the MCP activity log and most of the OAuth
provider's rejection paths went untested. This holds each file below to its
own floor, read from the .coverage data the suite just wrote.

    cd backend    && venv/bin/python   ../scripts/coverage-floors.py backend
    cd mcp_server && .venv/bin/python  ../scripts/coverage-floors.py mcp_server

Run by check.sh straight after each pytest step. Floors sit a few points
under today's figures; raise them as coverage rises, never lower one to make
a change pass — add the missing test instead.
"""

import io
import sys

import coverage

FLOORS: dict[str, dict[str, float]] = {
    "backend": {
        "app/middleware/deps.py": 95,
        "app/middleware/mcp_activity.py": 95,
        "app/services/auth.py": 95,
        "app/services/rate_limit.py": 95,
        "app/routes/auth.py": 90,
        "app/routes/api_keys.py": 90,
        "app/routes/users.py": 85,
    },
    "mcp_server": {
        "auth.py": 90,
        "lock.py": 95,
        "oauth_provider.py": 94,
    },
}


def main(suite: str) -> int:
    cov = coverage.Coverage()
    cov.load()
    failures = []
    for path, floor in FLOORS[suite].items():
        try:
            pct = cov.report(include=[path], file=io.StringIO())
        except coverage.exceptions.NoDataError:
            pct = 0.0
        if pct < floor:
            failures.append(f"  {path}: {pct:.1f}% < {floor}%")
    if failures:
        print(f"{suite}: below the per-file coverage floor (scripts/coverage-floors.py):")
        print("\n".join(failures))
        return 1
    print(f"{suite}: {len(FLOORS[suite])} files at or above their floor")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
