#!/usr/bin/env python3
"""Pick the Cypress specs one shard should run.

    e2e-shard.py 2/4          # comma-separated spec paths for shard 2 of 4

Specs are dealt out longest-first onto whichever shard is lightest (greedy LPT), using
the per-spec seconds in scripts/e2e-timings.json. A spec missing from that file —
a new one — weighs the average of the known ones, so it lands somewhere sensible
until `scripts/e2e-summary.py --update-timings` records its real cost. The result
is deterministic: every shard computes the same split independently.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC_DIR = ROOT / "frontend" / "cypress" / "e2e"
TIMINGS = Path(__file__).resolve().parent / "e2e-timings.json"


def shard(index: int, total: int) -> list[str]:
    specs = sorted(p.name for p in SPEC_DIR.glob("*.cy.ts"))
    known = json.loads(TIMINGS.read_text()) if TIMINGS.exists() else {}
    fallback = sum(known.values()) / len(known) if known else 1.0
    weight = {s: float(known.get(s, fallback)) for s in specs}

    buckets: list[list[str]] = [[] for _ in range(total)]
    load = [0.0] * total
    for spec in sorted(specs, key=lambda s: (-weight[s], s)):
        lightest = min(range(total), key=lambda i: (load[i], i))
        buckets[lightest].append(spec)
        load[lightest] += weight[spec]
    return [f"cypress/e2e/{s}" for s in sorted(buckets[index - 1])]


def main() -> int:
    try:
        index, total = (int(n) for n in sys.argv[1].split("/"))
        assert 1 <= index <= total
    except (IndexError, ValueError, AssertionError):
        print("usage: e2e-shard.py INDEX/TOTAL   (1-based, e.g. 2/4)", file=sys.stderr)
        return 2
    print(",".join(shard(index, total)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
