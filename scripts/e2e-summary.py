#!/usr/bin/env python3
"""Turn Cypress run output into a machine-readable summary, and merge shards.

    e2e-summary.py parse run.txt > shard.json       # one `cypress run` log
    e2e-summary.py merge a.json b.json > all.json   # shards -> one summary
    e2e-summary.py show all.json                    # human table, slowest first
    e2e-summary.py --update-timings all.json        # refresh scripts/e2e-timings.json

Sharding makes "grep the one 'All specs passed' line" meaningless, so every run
(local --parallel, CI shard) reduces to this JSON and scripts/test-report.sh reads
only the merged file. `duration_s` on a merged summary is the slowest shard — the
wall-clock — and `cpu_s` the sum, which is what the runners billed.
"""
import json
import re
import sys
from pathlib import Path

TIMINGS = Path(__file__).resolve().parent / "e2e-timings.json"
ROW = re.compile(
    r"│\s+(?P<mark>[✔✖−])\s+(?P<name>\S+\.cy\.ts)\s+(?P<dur>\S+)"
    r"\s+(?P<tests>\d+|-)\s+(?P<passing>\d+|-)\s+(?P<failing>\d+|-)"
    r"\s+(?P<pending>\d+|-)\s+(?P<skipped>\d+|-)\s*│"
)


def seconds(text: str) -> float:
    """Cypress prints 701ms under a second, else [HH:]MM:SS."""
    if text.endswith("ms"):
        return int(text[:-2]) / 1000
    parts = [int(p) for p in text.split(":")]
    total = 0
    for p in parts:
        total = total * 60 + p
    return float(total)


def num(text: str) -> int:
    return 0 if text == "-" else int(text)


def parse(log: str) -> dict:
    log = re.sub(r"\x1b\[[0-9;]*m", "", log)
    specs = []
    for m in ROW.finditer(log):
        specs.append(
            {
                "spec": m["name"],
                "seconds": seconds(m["dur"]),
                "tests": num(m["tests"]),
                "passing": num(m["passing"]),
                "failing": num(m["failing"]),
                "pending": num(m["pending"]),
                "skipped": num(m["skipped"]),
            }
        )
    return summarise(specs, wall=sum(s["seconds"] for s in specs))


def summarise(specs: list[dict], wall: float) -> dict:
    specs = sorted(specs, key=lambda s: s["spec"])
    return {
        "specs": specs,
        "tests": sum(s["tests"] for s in specs),
        "passing": sum(s["passing"] for s in specs),
        "failing": sum(s["failing"] for s in specs),
        "cpu_s": round(sum(s["seconds"] for s in specs), 1),
        "duration_s": round(wall, 1),
        "status": "pass" if specs and all(s["failing"] == 0 for s in specs) else "FAIL",
    }


def merge(paths: list[str]) -> dict:
    parts = [json.loads(Path(p).read_text()) for p in paths]
    specs = [s for part in parts for s in part["specs"]]
    out = summarise(specs, wall=max((p["duration_s"] for p in parts), default=0.0))
    out["shards"] = len(parts)
    return out


def clock(s: float) -> str:
    return f"{int(s) // 60}:{int(s) % 60:02d}"


def show(summary: dict) -> str:
    lines = [f"{'spec':<34}{'tests':>6}{'time':>8}"]
    for s in sorted(summary["specs"], key=lambda s: -s["seconds"]):
        flag = "" if s["failing"] == 0 else f"  ✖ {s['failing']} failing"
        lines.append(f"{s['spec']:<34}{s['tests']:>6}{clock(s['seconds']):>8}{flag}")
    shards = summary.get("shards", 1)
    lines.append(
        f"{summary['passing']}/{summary['tests']} passing, "
        f"{clock(summary['duration_s'])} wall-clock over {shards} shard(s), "
        f"{clock(summary['cpu_s'])} total spec time"
    )
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "parse":
        print(json.dumps(parse(Path(argv[1]).read_text()), indent=2))
    elif len(argv) >= 2 and argv[0] == "merge":
        print(json.dumps(merge(argv[1:]), indent=2))
    elif len(argv) == 2 and argv[0] == "show":
        print(show(json.loads(Path(argv[1]).read_text())))
    elif len(argv) == 2 and argv[0] == "--update-timings":
        summary = json.loads(Path(argv[1]).read_text())
        TIMINGS.write_text(
            json.dumps({s["spec"]: s["seconds"] for s in summary["specs"]}, indent=2, sort_keys=True) + "\n"
        )
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
