"""Keep existing backend quality debt visible while rejecting new diagnostics.

Generate the initial snapshot with ``--write-baseline`` in Python 3.11 after
installing backend requirements and the pinned Ruff/mypy versions in CI.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
BASELINE = ROOT / "scripts" / "backend-quality-baseline.json"
TOOL_VERSIONS = {"ruff": "0.16.9", "mypy": "1.14.1"}
MYPY_ERROR = re.compile(r"^(.+?\.py):(?:(\d+):(?:\d+:)?)? error: .*\[([\w-]+)\]$")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def run(
    command: list[str], cwd: Path = ROOT, input_text: str | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=False,
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def check_environment() -> None:
    if sys.version_info[:2] != (3, 11):
        raise RuntimeError("Backend quality baseline requires Python 3.11")
    for tool, expected in TOOL_VERSIONS.items():
        actual = version(tool)
        if actual != expected:
            raise RuntimeError(f"{tool} {expected} required; found {actual}")


def repo_path(filename: str, cwd: Path = ROOT) -> str:
    path = Path(filename)
    if not path.is_absolute():
        path = cwd / path
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError as exc:
        raise RuntimeError(f"Diagnostic outside repository: {filename}") from exc


def collect() -> dict[str, list[dict[str, object]]]:
    results: dict[str, list[dict[str, object]]] = {}
    for tool, command, cwd in (
        (
            "format",
            [
                sys.executable,
                "-m",
                "ruff",
                "format",
                "--check",
                "--output-format",
                "json",
                "backend",
            ],
            ROOT,
        ),
        (
            "lint",
            [
                sys.executable,
                "-m",
                "ruff",
                "check",
                "--output-format",
                "json",
                "backend",
            ],
            ROOT,
        ),
    ):
        process = run(command, cwd)
        if process.returncode not in (0, 1):
            raise RuntimeError(
                f"{tool} crashed ({process.returncode}): {process.stderr}"
            )
        try:
            raw = json.loads(process.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Invalid {tool} JSON: {process.stdout[:500]} {process.stderr[:500]}"
            ) from exc
        results[tool] = [
            {
                "file": repo_path(item["filename"]),
                "code": item["code"],
                "line": item["location"]["row"],
                "edits": [],
            }
            for item in raw
        ]

    process = run(
        [
            sys.executable,
            "-m",
            "mypy",
            "--strict",
            "--explicit-package-bases",
            "--show-error-codes",
            "agents",
            "services",
            "models",
        ],
        BACKEND,
    )
    if process.returncode not in (0, 1):
        raise RuntimeError(
            f"mypy crashed ({process.returncode}): {process.stdout[-500:]} {process.stderr[-500:]}"
        )
    diagnostics = []
    unmatched = []
    for line in process.stdout.splitlines():
        if " error: " not in line:
            continue
        match = MYPY_ERROR.match(line)
        if match is None:
            unmatched.append(line)
            continue
        filename, row, code = match.groups()
        diagnostics.append(
            {
                "file": repo_path(filename, BACKEND),
                "code": code,
                "line": int(row) if row else None,
                "edits": [],
            }
        )
    if unmatched:
        raise RuntimeError("Unparsed mypy errors:\n" + "\n".join(unmatched[:10]))
    results["mypy"] = diagnostics
    return results


def counts(
    results: dict[str, list[dict[str, object]]],
) -> dict[str, dict[str, dict[str, int]]]:
    output: dict[str, dict[str, dict[str, int]]] = {}
    for tool, diagnostics in results.items():
        files: dict[str, Counter[str]] = defaultdict(Counter)
        for diagnostic in diagnostics:
            files[str(diagnostic["file"])][str(diagnostic["code"])] += 1
        output[tool] = {
            path: dict(sorted(codes.items())) for path, codes in sorted(files.items())
        }
    return output


def changed_lines(base: str) -> tuple[dict[str, set[int]], set[str]]:
    exists = run(["git", "rev-parse", "--verify", f"{base}^{{commit}}"])
    if exists.returncode:
        raise RuntimeError(
            f"Cannot resolve quality comparison base {base}: {exists.stderr}"
        )
    diff = run(
        [
            "git",
            "-c",
            "core.quotePath=false",
            "diff",
            "--unified=0",
            "--diff-filter=ACMR",
            base,
            "--",
            "backend",
        ]
    )
    if diff.returncode:
        raise RuntimeError(f"Cannot diff backend changes: {diff.stderr}")
    additions: dict[str, set[int]] = defaultdict(set)
    changed: set[str] = set()
    current: str | None = None
    for line in diff.stdout.splitlines():
        if line.startswith("+++ "):
            current = line[4:].removeprefix("b/")
            if current.startswith("backend/") and current.endswith(".py"):
                changed.add(current)
            else:
                current = None
        elif current is not None:
            match = HUNK.match(line)
            if match:
                first = int(match.group(1))
                length = int(match.group(2) or "1")
                additions[current].update(range(first, first + length))

    untracked = run(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "backend"]
    )
    if untracked.returncode:
        raise RuntimeError(f"Cannot list new backend files: {untracked.stderr}")
    for name in untracked.stdout.splitlines():
        if name.endswith(".py"):
            changed.add(name)
            additions[name].update(
                range(
                    1, len((ROOT / name).read_text(encoding="utf-8").splitlines()) + 1
                )
            )
    return additions, changed


def formatting_rows(path: str) -> list[tuple[int, int]]:
    # Git can check out CRLF on Windows while CI sees LF. Normalize before
    # comparing Ruff's output so unrelated line endings do not look changed.
    source = (ROOT / path).read_text(encoding="utf-8")
    process = run(
        [sys.executable, "-m", "ruff", "format", "--stdin-filename", path, "-"],
        input_text=source,
    )
    if process.returncode:
        raise RuntimeError(f"Cannot format {path}: {process.stderr}")
    rows: set[int] = set()
    for operation, first, last, _, _ in difflib.SequenceMatcher(
        None, source.splitlines(), process.stdout.splitlines(), autojunk=False
    ).get_opcodes():
        if operation == "equal":
            continue
        if first == last:
            rows.add(first + 1)
        else:
            rows.update(range(first + 1, last + 1))
    return [(row, row) for row in sorted(rows)]


def on_added_line(
    diagnostic: dict[str, object],
    additions: dict[str, set[int]],
    changed: set[str],
    tool: str,
) -> bool:
    path = str(diagnostic["file"])
    if path not in changed:
        return False
    rows = additions.get(path, set())
    if diagnostic["line"] is None:
        return True
    if diagnostic["edits"]:
        for start, end in diagnostic["edits"]:
            if any(
                row in rows for row in range(int(start), max(int(start), int(end)) + 1)
            ):
                return True
    if tool == "format":
        return False
    return diagnostic["line"] in rows


def summary_line(text: str) -> None:
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--base", help="Git commit before this PR or push")
    args = parser.parse_args()
    check_environment()
    results = collect()
    current = counts(results)
    if args.write_baseline:
        BASELINE.write_text(
            json.dumps(
                {
                    "schema": 1,
                    "python": "3.11",
                    "tools": TOOL_VERSIONS,
                    "diagnostics": current,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {BASELINE}")
        return 0
    if not args.base:
        parser.error("--base is required when checking quality")
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    if (
        baseline.get("schema") != 1
        or baseline.get("python") != "3.11"
        or baseline.get("tools") != TOOL_VERSIONS
    ):
        raise RuntimeError("Quality baseline metadata does not match this checker")

    # Once established, a PR cannot raise its saved allowance.
    prior = run(["git", "show", f"{args.base}:scripts/backend-quality-baseline.json"])
    if prior.returncode == 0:
        previous = json.loads(prior.stdout).get("diagnostics", {})
        for tool, files in baseline["diagnostics"].items():
            for path, codes in files.items():
                for code, allowed in codes.items():
                    if allowed > previous.get(tool, {}).get(path, {}).get(code, 0):
                        raise RuntimeError(
                            f"Baseline allowance increased: {tool} {path} {code}"
                        )

    additions, changed = changed_lines(args.base)
    for diagnostic in results["format"]:
        if diagnostic["file"] in changed:
            diagnostic["edits"] = formatting_rows(str(diagnostic["file"]))
    failures = []
    for tool, diagnostics in results.items():
        old = baseline["diagnostics"].get(tool, {})
        for path, codes in current[tool].items():
            for code, amount in codes.items():
                allowed = old.get(path, {}).get(code, 0)
                if amount > allowed:
                    failures.append(
                        f"{tool}: {path} {code}: {amount} > baseline {allowed}"
                    )
        for diagnostic in diagnostics:
            if on_added_line(diagnostic, additions, changed, tool):
                failures.append(
                    f"{tool}: changed line {diagnostic['file']}:{diagnostic['line']} {diagnostic['code']}"
                )

    summary_line("### Backend quality ratchet")
    summary_line("| Check | Current findings | Baseline findings |")
    summary_line("| --- | ---: | ---: |")
    for tool in ("format", "lint", "mypy"):
        old = baseline["diagnostics"].get(tool, {})
        summary_line(
            f"| {tool} | {len(results[tool])} | {sum(sum(codes.values()) for codes in old.values())} |"
        )
    summary_line(
        f"Changed backend Python files: {len(changed)}. New findings or findings on added lines: {len(failures)}."
    )
    if failures:
        for failure in sorted(set(failures)):
            print(f"QUALITY FAIL: {failure}")
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"Backend quality checker failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
