"""CostGuardMiddleware tests."""
from __future__ import annotations

import secrets

import pytest

pytestmark = pytest.mark.asyncio


async def test_under_quota_passes(client) -> None:
    r = await client.post(
        "/api/generate",
        json={"idea_text": "An idea about gardens."},
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "cg-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code == 202


async def test_over_budget_402(client, monkeypatch) -> None:
    from services import cost_service

    async def _check(*, uid, period):
        return 9999  # absurdly over any cap

    monkeypatch.setattr(cost_service, "check_budget", _check, raising=False)

    r = await client.post(
        "/api/generate",
        json={"idea_text": "An idea about plants."},
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "cg-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code == 402
    body = r.json()
    assert body["code"] == "BUDGET_EXCEEDED"
    assert "tier" in body


async def test_quota_warning_header(client, monkeypatch) -> None:
    """Used > 80% of cap → x-quota-warning emitted."""
    from services import cost_service

    async def _check(*, uid, period):
        return 90  # > 80% of founder cap (100)

    monkeypatch.setattr(cost_service, "check_budget", _check, raising=False)

    r = await client.post(
        "/api/generate",
        json={"idea_text": "An idea about gardens."},
        headers={"authorization": "Bearer test", "content-type": "application/json",
                 "idempotency-key": "cg-" + secrets.token_urlsafe(12)},
    )
    assert r.status_code == 202
    assert "x-quota-warning" in r.headers
    assert r.headers.get("x-quota-cap") == "100"
