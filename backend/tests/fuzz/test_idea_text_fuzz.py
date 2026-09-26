"""Fuzz: idea_text with random Unicode, RTL, control chars never crashes."""

from __future__ import annotations

import secrets

import pytest

from api import routes_generate
from config import settings
from middleware.input_sanitization import _strip_controls

try:
    from hypothesis import HealthCheck, given
    from hypothesis import settings as hyp_settings
    from hypothesis import strategies as st

    HYPOTHESIS_OK = True
except ImportError:
    HYPOTHESIS_OK = False


@pytest.fixture
def fuzz_request_setup(monkeypatch) -> None:
    """Exercise request handling for every example without spending model budget."""

    async def _no_pipeline(*, session_id: str, idea_text: str, request_id: str) -> None:
        pass

    monkeypatch.setattr(settings, "hourly_rate_limit_per_uid", 1000)
    monkeypatch.setattr(settings, "daily_rate_limit_per_uid", 1000)
    monkeypatch.setattr(routes_generate, "_enqueue_pipeline_task", _no_pipeline)


@pytest.mark.skipif(not HYPOTHESIS_OK, reason="hypothesis not installed")
class TestIdeaTextFuzz:
    @pytest.mark.asyncio
    @hyp_settings(
        max_examples=80,
        deadline=None,
        # Each request has a unique idempotency key; sharing the test client is intentional.
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
    )
    @given(
        text=st.text(
            alphabet=st.characters(
                min_codepoint=0x20,
                max_codepoint=0xFFFF,
                blacklist_categories=("Cs",),  # Lone surrogates are not valid UTF-8 JSON.
            ),
            min_size=10,
            max_size=2000,
        )
    )
    async def test_random_text_does_not_crash(self, fuzz_request_setup, client, text: str) -> None:
        r = await client.post(
            "/api/generate",
            json={"idea_text": text},
            headers={
                "authorization": "Bearer test",
                "content-type": "application/json",
                "idempotency-key": "fz-" + secrets.token_urlsafe(12),
            },
        )
        # Input reaches validation for every example, rather than a shared rate limit.
        assert r.status_code in {202, 422}
        assert r.headers.get("content-type", "").startswith("application/json")
        assert isinstance(r.json(), dict)


def test_strip_controls_never_crashes() -> None:
    if not HYPOTHESIS_OK:
        pytest.skip("hypothesis not installed")

    @hyp_settings(max_examples=200, deadline=None)
    @given(text=st.text(min_size=0, max_size=1000))
    def _go(text: str) -> None:
        out = _strip_controls(text)
        assert isinstance(out, str)

    _go()
