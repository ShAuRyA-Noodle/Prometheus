"""Gemini structured-output and plain-text client.

Shared entry points for structured and plain-text Gemini calls. Uses the
``google-genai`` SDK. Structured calls enforce:
  - response_mime_type = application/json
  - response_schema   = pydantic model_json_schema (no regex-extraction fallbacks)
  - optional grounded google_search tool
  - tenacity retry (max 1 retry) with exponential backoff on 429 / transient
  - SAFETY block detection via finish_reason / prompt_feedback
  - usage_metadata token counting
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import structlog
from pydantic import BaseModel
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from config import settings

log = structlog.get_logger(__name__)


# ─── Lazy SDK import + client cache ──────────────────────────────────────────


_client: Any | None = None
_genai_types: Any | None = None


def _get_client() -> Any:
    """Lazy-create a single google-genai Client. Prefers Vertex AI in prod
    (Workload Identity), falls back to API key for local dev."""
    global _client, _genai_types
    if _client is not None:
        return _client

    from google import genai  # type: ignore[import-not-found]
    from google.genai import types as genai_types  # type: ignore[import-not-found]

    _genai_types = genai_types

    use_vertex = settings.env in ("staging", "prod") or bool(settings.google_cloud_project)
    api_key = settings.gemini_api_key or os.environ.get("GOOGLE_API_KEY", "")

    if use_vertex and settings.google_cloud_project and not api_key:
        _client = genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.vertex_ai_location,
        )
        log.info("gemini.client.vertex", project=settings.google_cloud_project, location=settings.vertex_ai_location)
    elif api_key:
        _client = genai.Client(api_key=api_key)
        log.info("gemini.client.api_key")
    else:
        # Final fallback: empty key — calls will fail but module imports cleanly.
        _client = genai.Client(api_key="")
        log.warning("gemini.client.no_credentials")

    return _client


# ─── Errors ──────────────────────────────────────────────────────────────────


class GeminiError(RuntimeError):
    """Generic Gemini failure (non-safety)."""


class GeminiTransientError(GeminiError):
    """5xx / 429 / network — retryable."""


class GeminiSchemaError(GeminiError):
    """Model returned non-JSON or empty payload."""


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _extract_token_counts(response: Any) -> tuple[int, int]:
    """Pull (prompt_token_count, candidates_token_count) from usage_metadata."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return 0, 0
    in_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
    out_tokens = int(
        getattr(usage, "candidates_token_count", 0)
        or getattr(usage, "candidates_tokens_count", 0)
        or 0
    )
    return in_tokens, out_tokens


def _was_safety_blocked(response: Any) -> bool:
    """Detect SAFETY-style block on either prompt or candidate."""
    pf = getattr(response, "prompt_feedback", None)
    if pf is not None:
        block_reason = getattr(pf, "block_reason", None)
        if block_reason is not None:
            br = str(block_reason).upper()
            if br and br not in ("BLOCK_REASON_UNSPECIFIED", "0"):
                return True

    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        finish = getattr(cand, "finish_reason", None)
        if finish is not None:
            fr = str(finish).upper()
            if "SAFETY" in fr or "BLOCK" in fr or "PROHIBITED" in fr:
                return True
    return False


def _extract_text(response: Any) -> str:
    """Best-effort text extraction from genai response."""
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text

    candidates = getattr(response, "candidates", None) or []
    chunks: list[str] = []
    for cand in candidates:
        content = getattr(cand, "content", None)
        if content is None:
            continue
        parts = getattr(content, "parts", None) or []
        for part in parts:
            ptext = getattr(part, "text", None)
            if isinstance(ptext, str):
                chunks.append(ptext)
    return "".join(chunks)


def _build_config(
    *,
    response_schema: type[BaseModel],
    grounded: bool,
    temperature: float,
) -> Any:
    """Build a genai GenerateContentConfig. Schema is the pydantic model class
    itself when supported, else its JSON schema dict."""
    assert _genai_types is not None  # _get_client populates this

    tools = []
    if grounded:
        # Google Search grounding tool
        try:
            tools.append(_genai_types.Tool(google_search=_genai_types.GoogleSearch()))
        except Exception:  # noqa: BLE001
            # Older SDK shape — try google_search_retrieval
            try:
                tools.append(
                    _genai_types.Tool(
                        google_search_retrieval=_genai_types.GoogleSearchRetrieval()
                    )
                )
            except Exception:
                log.warning("gemini.grounding_tool_unavailable")

    cfg_kwargs: dict[str, Any] = {
        "temperature": temperature,
        "response_mime_type": "application/json",
        # Pydantic model is preferred — SDK introspects it
        "response_schema": response_schema,
    }
    if tools:
        cfg_kwargs["tools"] = tools

    try:
        return _genai_types.GenerateContentConfig(**cfg_kwargs)
    except TypeError:
        # SDK shape variation — drop tools and retry
        cfg_kwargs.pop("tools", None)
        cfg = _genai_types.GenerateContentConfig(**cfg_kwargs)
        if tools:
            try:
                cfg.tools = tools
            except Exception:
                log.warning("gemini.config.tools_drop")
        return cfg


def _classify_exception(exc: BaseException) -> type[Exception]:
    """Map google-api errors into transient vs permanent."""
    msg = str(exc).lower()
    if any(
        token in msg
        for token in (
            "429",
            "rate limit",
            "resource_exhausted",
            "deadline",
            "unavailable",
            "503",
            "504",
            "internal error",
            "500",
        )
    ):
        return GeminiTransientError
    return GeminiError


# ─── Public API ──────────────────────────────────────────────────────────────


async def call_gemini_structured(
    model: str,
    prompt: str,
    response_schema: type[BaseModel],
    grounded: bool = False,
    temperature: float = 0.4,
) -> tuple[dict[str, Any], int, int, bool]:
    """Run a single structured Gemini call.

    Returns: (raw_dict_payload, input_tokens, output_tokens, was_safety_blocked)

    On safety block returns ({}, 0, 0, True) without raising — caller decides.
    On schema/parse failure raises ``GeminiSchemaError``.
    On non-retryable API failure raises ``GeminiError``.
    """
    client = _get_client()
    config = _build_config(
        response_schema=response_schema,
        grounded=grounded,
        temperature=temperature,
    )

    async def _attempt() -> Any:
        try:
            return await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=prompt,
                config=config,
            )
        except Exception as exc:  # noqa: BLE001
            cls = _classify_exception(exc)
            raise cls(str(exc)) from exc

    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),  # max 1 retry
            wait=wait_exponential(multiplier=1.0, min=1.0, max=8.0),
            retry=retry_if_exception_type(GeminiTransientError),
            reraise=True,
        ):
            with attempt:
                response = await _attempt()
    except RetryError as re:
        raise GeminiError("retry exhausted") from re

    in_tok, out_tok = _extract_token_counts(response)

    if _was_safety_blocked(response):
        log.warning("gemini.safety_blocked", model=model)
        return {}, in_tok, out_tok, True

    text = _extract_text(response)
    if not text or not text.strip():
        raise GeminiSchemaError("empty model response")

    # Prefer parsed pydantic object if SDK populated it
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        try:
            if isinstance(parsed, BaseModel):
                payload = parsed.model_dump(mode="json")
            elif isinstance(parsed, dict):
                payload = parsed
            elif isinstance(parsed, list):
                payload = {"items": parsed}
            else:
                # Fallback to JSON parse of text
                payload = json.loads(text)
            return payload, in_tok, out_tok, False
        except Exception:  # noqa: BLE001
            pass

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as je:
        # We do NOT do regex repair (per project rules).
        log.warning("gemini.json_parse_fail", text_chars=len(text))
        raise GeminiSchemaError(f"invalid json: {je}") from je

    if not isinstance(payload, dict):
        # Schema may permit list; wrap so caller's pydantic validator can decide
        if isinstance(payload, list):
            return {"items": payload}, in_tok, out_tok, False
        raise GeminiSchemaError("non-object json payload")

    return payload, in_tok, out_tok, False


async def call_gemini_text(
    model: str,
    prompt: str,
    temperature: float = 0.4,
    max_output_tokens: int = 1024,
) -> str:
    """Generate plain text for summaries and brand-name alternatives.

    Safety blocks and empty responses are errors so callers can use their
    existing fallback paths instead of treating missing text as success.
    """
    client = _get_client()
    assert _genai_types is not None  # _get_client populates this
    config = _genai_types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )

    async def _attempt() -> object:
        try:
            return await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=prompt,
                config=config,
            )
        except Exception as exc:
            cls = _classify_exception(exc)
            raise cls(str(exc)) from exc

    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),
            wait=wait_exponential(multiplier=1.0, min=1.0, max=8.0),
            retry=retry_if_exception_type(GeminiTransientError),
            reraise=True,
        ):
            with attempt:
                response = await _attempt()
    except RetryError as re:
        raise GeminiError("retry exhausted") from re

    if _was_safety_blocked(response):
        log.warning("gemini.safety_blocked", model=model)
        raise GeminiError("model response blocked by safety filters")

    text = _extract_text(response).strip()
    if not text:
        raise GeminiSchemaError("empty model response")
    return text


__all__ = [
    "GeminiError",
    "GeminiSchemaError",
    "GeminiTransientError",
    "call_gemini_structured",
    "call_gemini_text",
]
