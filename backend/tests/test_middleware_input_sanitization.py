"""InputSanitizationMiddleware tests."""
from __future__ import annotations

import secrets

import pytest

pytestmark = pytest.mark.asyncio


async def test_strips_control_chars(client, in_memory_firestore) -> None:
    """Control chars in JSON string fields are stripped before route handler sees them."""
    body = {"idea_text": "An\x07 idea about plants and reconciliation tools."}
    r = await client.post(
        "/api/generate",
        json=body,
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "sn-" + secrets.token_urlsafe(12)},
    )
    # Cleaned body passes Pydantic validator that rejects control chars.
    assert r.status_code == 202, r.text


async def test_oversize_body_413(client) -> None:
    """Body > 4*input_length_cap_chars + slack → 413."""
    huge = "a" * 100_000
    body = {"idea_text": huge}
    r = await client.post(
        "/api/generate",
        json=body,
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "sn-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code in {413, 422}


async def test_invalid_json_400(client) -> None:
    r = await client.post(
        "/api/generate",
        content=b"{ this is not valid json",
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "sn-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_JSON"


async def test_zero_width_chars_removed(client) -> None:
    """Zero-width and bidi-override chars are stripped."""
    body = {"idea_text": "An e​commerce‍ idea‮ backwards."}
    r = await client.post(
        "/api/generate",
        json=body,
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "sn-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code == 202


async def test_get_method_skipped(client) -> None:
    """GETs aren't sanitized (no JSON body)."""
    r = await client.get("/api/me")
    assert r.status_code in {200, 404}
