"""Run every saved founder idea through the full, locally mocked pipeline."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest

from agents.orchestrator import build_orchestrator
from config import settings
from models.session_models import AgentName, AgentStatusValue, Session, SessionStatus
from services import gemini_client
from tests.conftest import _default_for_schema
from tests.test_pipeline import _patch_after_model_services

_IDEAS = json.loads(Path(__file__).with_name("ideas.json").read_text(encoding="utf-8"))

pytestmark = pytest.mark.golden


def test_golden_corpus_is_complete() -> None:
    """A deleted or duplicated case must never silently reduce coverage."""
    assert [idea["id"] for idea in _IDEAS] == [f"g{number:02d}" for number in range(1, 51)]
    assert all(idea["idea"].strip() and idea["industry"] and idea["geo"] for idea in _IDEAS)


@pytest.mark.parametrize("idea", _IDEAS, ids=lambda idea: idea["id"])
@pytest.mark.asyncio
async def test_golden_idea_completes_full_pipeline(
    idea: dict[str, str], monkeypatch: pytest.MonkeyPatch, mock_gemini: Any
) -> None:
    _patch_after_model_services(monkeypatch)
    monkeypatch.setattr(settings, "vertex_safety_enabled", False)

    # These agents import summarize_all directly, so patch their references too.
    async def summarize_locally(state: dict[str, Any], keys: list[str]) -> dict[str, str]:
        return {f"{key.replace('_result', '')}_summary": "Mocked summary" for key in keys}

    monkeypatch.setattr(import_module("agents.pitch_deck_agent"), "summarize_all", summarize_locally)
    monkeypatch.setattr(import_module("agents.executive_summary_agent"), "summarize_all", summarize_locally)

    parser_response = _default_for_schema("ParsedIdea")
    parser_response.update(idea_summary=idea["idea"], industry=idea["industry"], geography=idea["geo"])
    mock_gemini("ParsedIdea", parser_response)

    mocked_call = gemini_client.call_gemini_structured
    parser_prompts: list[str] = []

    async def record_parser_prompt(**kwargs: Any) -> tuple[dict[str, Any], int, int, bool]:
        if kwargs["response_schema"].__name__ == "ParsedIdea":
            parser_prompts.append(kwargs["prompt"])
        return await mocked_call(**kwargs)

    monkeypatch.setattr(gemini_client, "call_gemini_structured", record_parser_prompt)

    session = Session(
        session_id=f"sess_golden_{idea['id']}",
        user_uid="uid_golden",
        idempotency_key=f"idem_{idea['id']}",
        idea_text_hash="0" * 64,
        idea_text=idea["idea"],
        status=SessionStatus.QUEUED,
        created_at=datetime.now(UTC),
    )
    orchestrator = build_orchestrator({"session": session, "idea_text": idea["idea"]})
    result = await orchestrator.run()

    assert len(parser_prompts) == 1
    assert idea["idea"] in parser_prompts[0]
    parsed = orchestrator.state["parsed_idea"]
    assert parsed.idea_summary == idea["idea"]
    assert parsed.industry == idea["industry"]
    assert parsed.geography == idea["geo"]

    assert result.status == SessionStatus.COMPLETED, (result.error_code, result.error_message)
    assert [(gate.wave, gate.passed) for gate in orchestrator.gate_results] == [
        ("wave_1", True),
        ("wave_2", True),
        ("wave_3", True),
    ]
    assert all(result.agents[name].status == AgentStatusValue.COMPLETED for name in AgentName)
    assert result.cost.total_input_tokens > 0
    assert result.cost.total_output_tokens > 0
    assert 0 < result.cost.total_cost_usd <= settings.max_cost_usd_per_session
