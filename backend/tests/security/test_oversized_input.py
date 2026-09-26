"""Oversized input → 413 (or 422 if Pydantic catches the length cap first)."""
from __future__ import annotations

import secrets

import pytest

pytestmark = [pytest.mark.security, pytest.mark.asyncio]


async def test_megabyte_idea_rejected(client) -> None:
    body = {"idea_text": "x" * (1_000_000)}
    r = await client.post(
        "/api/generate",
        json=body,
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "ov-" + secrets.token_urlsafe(12)},
    )
    # 413 from sanitization middleware (body > 4*cap+slack) is the most likely.
    assert r.status_code in {413, 422}
    body_json = r.json()
    assert body_json["code"] in {"PAYLOAD_TOO_LARGE", "VALIDATION_ERROR"}


async def test_large_inside_envelope_caught_by_pydantic(client) -> None:
    """Body is below the byte cap but idea_text exceeds 2000 chars."""
    body = {"idea_text": "x" * 3000}
    r = await client.post(
        "/api/generate",
        json=body,
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "ov-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code == 422
    assert "x" * 100 not in r.text
    assert r.json()["code"] == "VALIDATION_ERROR"
