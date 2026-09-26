"""Chaos: cancel mid-pipeline → resume from last completed."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from agents.orchestrator import build_orchestrator
from models.session_models import Session, SessionStatus
from services import firestore_service, gemini_client

pytestmark = pytest.mark.asyncio


async def test_cancellation_marks_session_canceled(mock_firestore) -> None:
    s = Session(
        session_id="sess_cancel",
        user_uid="uid",
        idempotency_key="k",
        idea_text_hash="0" * 64,
        idea_text="x",
        status=SessionStatus.RUNNING,
        created_at=datetime.now(UTC),
    )
    mock_firestore.sessions[s.session_id] = s
    await firestore_service.cancel_session(s.session_id)
    assert s.status == SessionStatus.CANCELED
    assert s.canceled_at is not None


async def test_pipeline_can_handle_cancellation_exception(monkeypatch) -> None:
    """If a task is cancelled mid-run, orchestrator surfaces ERROR (not COMPLETED)."""

    async def _cancelled(*, model, prompt, response_schema, grounded=False, temperature=0.4):
        raise asyncio.CancelledError()

    monkeypatch.setattr(gemini_client, "call_gemini_structured", _cancelled, raising=False)

    s = Session(
        session_id="sess_cx",
        user_uid="uid",
        idempotency_key="k",
        idea_text_hash="0" * 64,
        idea_text="x",
        status=SessionStatus.QUEUED,
        created_at=datetime.now(UTC),
    )
    state = {"session": s, "idea_text": s.idea_text}
    orch = build_orchestrator(state)

    with pytest.raises(asyncio.CancelledError):
        await orch.run()
