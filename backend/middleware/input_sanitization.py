"""InputSanitizationMiddleware.

- Rejects request bodies > settings.input_length_cap_chars * 4 (rough byte cap).
- Strips ASCII / Unicode control chars.
- Normalizes Unicode to NFKC on string fields of JSON bodies.
- Does NOT mutate non-JSON content types (e.g., multipart/form-data uploads
  for /api/speech/transcribe — those are bytes).

Belt-and-suspenders against XSS / SVG / null-byte / RTL-override attacks.
The sanitization here is a prophylactic; downstream code (`services/sanitization.py`)
handles HTML/SVG content that is rendered in the DOM.
"""
from __future__ import annotations

import json
import unicodedata
from typing import Any

import orjson
import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import settings

log = structlog.get_logger("sanitization")

# C0 controls except \t\n\r, plus C1 controls, plus bidi/zero-width abuse vectors.
_CONTROL_RANGES = [
    (0x00, 0x08),
    (0x0B, 0x0C),
    (0x0E, 0x1F),
    (0x7F, 0x9F),
]
_ZERO_WIDTH_AND_BIDI = {
    "​", "‌", "‍", "⁠", "﻿",
    "‪", "‫", "‬", "‭", "‮",
    "⁦", "⁧", "⁨", "⁩",
}


def _strip_controls(s: str) -> str:
    out: list[str] = []
    for ch in s:
        cp = ord(ch)
        if any(lo <= cp <= hi for lo, hi in _CONTROL_RANGES):
            continue
        if ch in _ZERO_WIDTH_AND_BIDI:
            continue
        out.append(ch)
    return unicodedata.normalize("NFKC", "".join(out))


def _walk(obj: Any) -> Any:
    if isinstance(obj, str):
        return _strip_controls(obj)
    if isinstance(obj, list):
        return [_walk(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _walk(v) for k, v in obj.items()}
    return obj


# Routes whose body must NOT be touched (binary payloads, signature-sensitive, etc.).
_BYPASS_PATHS = (
    "/api/speech/transcribe",
    "/api/billing/webhook",
)
_MAX_BYTES = settings.input_length_cap_chars * 4 + 8192  # JSON envelope slack


class InputSanitizationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in {"GET", "HEAD", "OPTIONS", "DELETE"}:
            return await call_next(request)

        if any(request.url.path.startswith(p) for p in _BYPASS_PATHS):
            return await call_next(request)

        ctype = request.headers.get("content-type", "")
        if "application/json" not in ctype.lower():
            return await call_next(request)

        body = await request.body()
        if len(body) > _MAX_BYTES:
            log.warning("payload_too_large", bytes=len(body), path=request.url.path)
            return JSONResponse(
                status_code=413,
                content={
                    "code": "PAYLOAD_TOO_LARGE",
                    "message": f"request body exceeds {_MAX_BYTES} bytes",
                    "request_id": getattr(request.state, "request_id", None),
                },
            )

        if not body:
            return await call_next(request)

        try:
            parsed = orjson.loads(body)
        except orjson.JSONDecodeError:
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                return JSONResponse(
                    status_code=400,
                    content={
                        "code": "INVALID_JSON",
                        "message": "request body is not valid JSON",
                        "request_id": getattr(request.state, "request_id", None),
                    },
                )

        cleaned = _walk(parsed)
        new_body = orjson.dumps(cleaned)

        # BaseHTTPMiddleware's cached request forwards `_body` to the inner
        # app; changing only `_receive` leaves the original body cached.
        request._body = new_body  # type: ignore[attr-defined]  # noqa: SLF001

        # Re-inject cleaned body into the ASGI receive stream.
        async def receive() -> dict[str, Any]:
            return {"type": "http.request", "body": new_body, "more_body": False}

        request._receive = receive  # type: ignore[attr-defined]  # noqa: SLF001
        return await call_next(request)
