"""SSE stream tests."""
from __future__ import annotations

import asyncio
import secrets
from datetime import UTC, datetime

import pytest

pytestmark = pytest.mark.asyncio


def _make_session(uid: str):
    from models.session_models import Session, SessionStatus

    return Session(
        session_id=f"sess_{secrets.token_urlsafe(8)}",
        user_uid=uid,
        idempotency_key="k",
        idea_text_hash="0" * 64,
        idea_text="x",
        status=SessionStatus.RUNNING,
        created_at=datetime.now(UTC),
    )


async def test_sse_initial_snapshot_and_terminal(client, in_memory_firestore, fake_auth_user) -> None:
    from services import sse_service

    s = _make_session(fake_auth_user.uid)
    in_memory_firestore.sessions[s.session_id] = s

    # Pre-publish a terminal event so the stream completes quickly.
    await sse_service.publish(
        s.session_id,
        {"event": "agent_completed", "data": {"agent": "idea_parser", "status": "completed"}},
    )
    await sse_service.publish(
        s.session_id,
        {"event": "terminal", "data": {"status": "completed"}},
    )

    async with client.stream(
        "GET",
        f"/sse/sessions/{s.session_id}",
        headers={"authorization": "Bearer test"},
    ) as r:
        assert r.status_code == 200
        assert "text/event-stream" in r.headers["content-type"]
        chunks: list[str] = []
        async for chunk in r.aiter_text():
            chunks.append(chunk)
            if "event: terminal" in chunk:
                break

    body = "".join(chunks)
    assert "event: snapshot" in body
    assert "event: agent_completed" in body
    assert "event: terminal" in body


async def test_sse_unauthorized_when_no_token(client, in_memory_firestore) -> None:
    s = _make_session("uid_other")
    in_memory_firestore.sessions[s.session_id] = s

    r = await client.get(f"/sse/sessions/{s.session_id}", headers={"authorization": ""})
    assert r.status_code == 401


async def test_sse_idor_403(client, in_memory_firestore) -> None:
    s = _make_session("uid_other")
    in_memory_firestore.sessions[s.session_id] = s

    r = await client.get(
        f"/sse/sessions/{s.session_id}",
        headers={"authorization": "Bearer test"},
    )
    assert r.status_code == 403


async def test_sse_terminal_on_already_done(client, in_memory_firestore, fake_auth_user) -> None:
    """Session already terminal → emit snapshot then terminal and stop."""
    from models.session_models import SessionStatus

    s = _make_session(fake_auth_user.uid)
    s.status = SessionStatus.COMPLETED
    in_memory_firestore.sessions[s.session_id] = s

    async with client.stream(
        "GET",
        f"/sse/sessions/{s.session_id}",
        headers={"authorization": "Bearer test"},
    ) as r:
        assert r.status_code == 200
        body = ""
        async for chunk in r.aiter_text():
            body += chunk
            if "terminal" in chunk:
                break
    assert "event: terminal" in body
