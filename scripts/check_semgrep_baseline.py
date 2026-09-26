"""Fail the security scan on findings beyond the small reviewed baseline.

The raw Semgrep JSON is retained as a workflow artifact, including baseline
findings. Every rule still scans every file. An entry only matches the same
rule, path, and exact source span; new or changed findings fail the job.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

BASELINE = Path(__file__).resolve().parent / "semgrep-baseline.json"


def identity(result: dict[str, Any]) -> tuple[str, str, str]:
    path = Path(result["path"])
    source = path.read_text(encoding="utf-8").splitlines()
    start = result["start"]["line"]
    end = result["end"]["line"]
    if start < 1 or end < start or end > len(source):
        raise ValueError(f"Invalid Semgrep span in {path}: {start}-{end}")
    return (
        result["check_id"],
        path.as_posix(),
        "\n".join(line.strip() for line in source[start - 1 : end]),
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: check_semgrep_baseline.py semgrep-report.json", file=sys.stderr)
        return 2
    report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    failures = [
        error for error in report.get("errors", []) if error.get("level") == "error"
    ]
    if failures:
        print(f"Semgrep reported {len(failures)} scan errors", file=sys.stderr)
        return 1
    if report.get("errors"):
        print(
            f"Semgrep reported {len(report['errors'])} nonfatal parse warnings; see the raw report"
        )

    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))["findings"]
    allowed = Counter(
        (entry["rule"], entry["path"], entry["source"]) for entry in baseline
    )
    if any(count != 1 for count in allowed.values()):
        raise ValueError("Duplicate Semgrep baseline entry")
    if any(not entry.get("reason") for entry in baseline):
        raise ValueError("Every Semgrep baseline entry needs a reason")

    new: list[dict[str, Any]] = []
    for result in report["results"]:
        key = identity(result)
        if allowed[key]:
            allowed[key] -= 1
        else:
            new.append(result)

    reviewed = len(baseline) - sum(allowed.values())
    print(
        f"Semgrep findings: {len(report['results'])}; reviewed baseline: {reviewed}; new: {len(new)}"
    )
    for result in new:
        print(f"NEW {result['path']}:{result['start']['line']} {result['check_id']}")
    for (rule, path, _), count in allowed.items():
        if count:
            print(f"Baseline entry no longer found: {path} {rule}")
    return 1 if new else 0


if __name__ == "__main__":
    raise SystemExit(main())
