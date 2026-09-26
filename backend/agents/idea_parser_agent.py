"""Idea Parser Agent — Pre-Wave, Flash. Extracts ParsedIdea from raw text."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, ClassVar

from config import settings
from models.agent_schemas import ParsedIdea
from models.session_models import AgentName, Wave
from services.sanitization import wrap_user_input_safe

from .base import PrometheusAgent

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "idea_parser.txt"


class IdeaParserAgent(PrometheusAgent[ParsedIdea]):
    name: ClassVar[AgentName] = AgentName.IDEA_PARSER
    wave: ClassVar[Wave] = Wave.PRE
    model: ClassVar[str] = settings.model_flash
    output_schema: ClassVar[type] = ParsedIdea
    prompt_template: ClassVar[str] = _PROMPT_PATH.read_text(encoding="utf-8")
    requires_grounding: ClassVar[bool] = False
    timeout_seconds: ClassVar[int] = 8  # ~3s typical; cushion for retry
    temperature: ClassVar[float] = 0.2

    @property
    def output_key(self) -> str:
        return "parsed_idea"

    def render_prompt(self, state: dict[str, Any]) -> str:
        # JSON escaping prevents founder text from closing the prompt's quoted
        # input field or introducing new prompt sections via raw newlines.
        idea_text = json.dumps(str(state.get("idea_text") or ""), ensure_ascii=True)
        return self.prompt_template.format(idea_text=wrap_user_input_safe(idea_text))


idea_parser_agent = IdeaParserAgent()
