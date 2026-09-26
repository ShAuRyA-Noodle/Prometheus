"""Enforce the measured backend coverage floor and report changed-code coverage."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
BASELINE = Path(__file__).with_name("backend-coverage-baseline.json")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def git(*args: str) -> str:
    process = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=False
    )
    if process.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {process.stderr.strip()}")
    return process.stdout


def changed_lines(base: str) -> dict[str, set[int]]:
    """Map repository paths to added line numbers in this commit range."""
    git("rev-parse", "--verify", f"{base}^{{commit}}")
    diff = git(
        "diff", "--unified=0", "--diff-filter=ACMR", base, "HEAD", "--", "backend"
    )
    changed: dict[str, set[int]] = defaultdict(set)
    path: str | None = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            candidate = line[4:].removeprefix("b/")
            path = (
                candidate
                if candidate.startswith("backend/") and candidate.endswith(".py")
                else None
            )
        elif path is not None:
            match = HUNK.match(line)
            if match:
                start = int(match.group(1))
                length = int(match.group(2) or "1")
                changed[path].update(range(start, start + length))
    return dict(changed)


def print_summary(line: str) -> None:
    print(line)
    output = os.environ.get("GITHUB_STEP_SUMMARY")
    if output:
        with open(output, "a", encoding="utf-8") as summary:
            summary.write(line + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--base", required=True)
    args = parser.parse_args()

    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    if baseline.get("schema") != 1:
        raise RuntimeError("unsupported coverage baseline schema")
    floor = float(baseline["minimum_percent"])
    target = float(baseline["target_percent"])
    if floor > target:
        raise RuntimeError("coverage floor exceeds target")

    try:
        previous = json.loads(
            git("show", f"{args.base}:scripts/backend-coverage-baseline.json")
        )
    except RuntimeError:
        previous = None  # First adoption of the baseline.
    if previous and floor < float(previous["minimum_percent"]):
        raise RuntimeError("coverage baseline floor cannot decrease")

    report = json.loads(args.report.read_text(encoding="utf-8"))
    actual = float(report["totals"]["percent_covered"])
    source_files: dict[str, dict] = {}
    for filename, details in report["files"].items():
        path = Path(filename)
        if not path.is_absolute():
            path = BACKEND / path
        try:
            relative = path.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            continue
        source_files[relative] = details

    print_summary("### Backend coverage")
    print_summary(
        f"Full-suite coverage: **{actual:.2f}%**; measured floor: **{floor:.2f}%**; target: **{target:.2f}%**."
    )
    print_summary(
        "| Changed production file | Covered added lines | Executable added lines |"
    )
    print_summary("| --- | ---: | ---: |")
    covered_total = 0
    executable_total = 0
    unmeasured = []
    for filename, added in sorted(changed_lines(args.base).items()):
        if filename.startswith("backend/tests/") or not added:
            continue
        details = source_files.get(filename)
        if details is None:
            unmeasured.append(filename)
            continue
        covered = len(added.intersection(details["executed_lines"]))
        executable = len(
            added.intersection(
                set(details["executed_lines"]) | set(details["missing_lines"])
            )
        )
        covered_total += covered
        executable_total += executable
        print_summary(f"| `{filename}` | {covered} | {executable} |")
    if executable_total:
        print_summary(
            f"Changed production lines covered: **{covered_total}/{executable_total} ({covered_total / executable_total * 100:.1f}%)**."
        )
    else:
        print_summary("No executable production lines were added in this comparison.")

    if unmeasured:
        for filename in unmeasured:
            print(
                f"COVERAGE FAIL: changed source file missing from report: {filename}",
                file=sys.stderr,
            )
    if actual + 1e-9 < floor:
        print(
            f"COVERAGE FAIL: {actual:.2f}% is below the documented {floor:.2f}% floor",
            file=sys.stderr,
        )
    return 1 if unmeasured or actual + 1e-9 < floor else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"Coverage checker failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
