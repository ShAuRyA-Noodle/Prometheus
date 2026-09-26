"""CSRF: POST /api/session/{id}/export without Bearer → 401."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

import pytest

pytestmark = [pytest.mark.security, pytest.mark.asyncio]


async def test_export_without_bearer_401(client, in_memory_firestore, fake_auth_user) -> None:
    from models.session_models import Session, SessionStatus

    s = Session(
        session_id=f"sess_{secrets.token_urlsafe(8)}",
        user_uid=fake_auth_user.uid,
        idempotency_key="k",
        idea_text_hash="0" * 64,
        idea_text="x",
        status=SessionStatus.COMPLETED,
        created_at=datetime.now(UTC),
    )
    in_memory_firestore.sessions[s.session_id] = s

    r = await client.post(
        f"/api/session/{s.session_id}/export",
        json={"session_id": s.session_id, "targets": ["json"]},
        headers={
            "authorization": "",
            "content-type": "application/json",
            "idempotency-key": "csrf-" + secrets.token_urlsafe(12),
        },
    )
    assert r.status_code == 401


async def test_deploy_without_bearer_401(client, in_memory_firestore, fake_auth_user) -> None:
    from models.session_models import Session, SessionStatus

    s = Session(
        session_id=f"sess_{secrets.token_urlsafe(8)}",
        user_uid=fake_auth_user.uid,
        idempotency_key="k",
        idea_text_hash="0" * 64,
        idea_text="x",
        status=SessionStatus.COMPLETED,
        created_at=datetime.now(UTC),
    )
    in_memory_firestore.sessions[s.session_id] = s
    r = await client.post(
        f"/api/session/{s.session_id}/deploy",
        json={"session_id": s.session_id, "domain": None, "purchase_domain": False},
        headers={
            "authorization": "",
            "content-type": "application/json",
            "idempotency-key": "csrf2-" + secrets.token_urlsafe(12),
        },
    )
    assert r.status_code == 401
