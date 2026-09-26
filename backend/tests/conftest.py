"""Pytest fixtures for PROMETHEUS backend tests.

Conventions:
- All Gemini calls are mocked via the `mock_gemini` fixture (no network).
- Firestore is mocked by an in-memory dict-backed shim (`mock_firestore`).
- Auth is bypassed via `fake_auth_user` (returns a deterministic AuthedUser).
- `client` is an httpx.AsyncClient against the FastAPI app (ASGITransport).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Callable
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

# Ensure backend/ is on sys.path so `import config`, `import main` work without packaging.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Reasonable env defaults so config.Settings() doesn't blow up when the test
# session doesn't ship a .env.
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("CLOUD_TASKS_WORKER_URL", "")  # forces dev inline dispatch
os.environ.setdefault("VERTEX_SAFETY_ENABLED", "false")  # tests must not call live Vertex
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_test")


# ─── auth ────────────────────────────────────────────────────────────────────


@pytest.fixture
def fake_auth_user() -> Any:
    from middleware.auth import AuthedUser

    return AuthedUser(
        uid="uid_test_123",
        email="user@example.com",
        is_anonymous=False,
        tier="founder",
        role="user",
        raw_claims={"sub": "uid_test_123"},
    )


# ─── firestore in-memory shim ────────────────────────────────────────────────


class _InMemoryFirestore:
    """A tiny in-memory replacement for the parts of services.firestore_service
    used by routes/middleware. Each public method matches the production async
    signature."""

    def __init__(self) -> None:
        self.sessions: dict[str, Any] = {}
        self.outputs: dict[tuple[str, str], dict] = {}
        self.idempotency: dict[tuple[str, str], str] = {}
        self.users: dict[str, Any] = {}
        self.processed_stripe_events: set[str] = set()
        self.canceled: set[str] = set()
        self.tombstoned: set[str] = set()

    async def create_session(self, session: Any) -> None:
        self.sessions[session.session_id] = session
        self.idempotency[(session.user_uid, session.idempotency_key)] = session.session_id

    async def update_session_status(
        self,
        session_id: str,
        status: Any,
        *,
        completed_at: Any = None,
        error_code: str | None = None,
        error_message: str | None = None,
        extra: dict | None = None,
    ) -> None:
        s = self.sessions.get(session_id)
        if s is None:
            return
        s.status = status
        if completed_at is not None:
            s.completed_at = completed_at
        if error_code is not None:
            s.error_code = error_code
        if error_message is not None:
            s.error_message = error_message

    async def update_agent_status(
        self, *, session_id: str, agent: Any, status: str
    ) -> None:
        from models.session_models import AgentStatusValue
        s = self.sessions.get(session_id)
        if s is None:
            return
        rec = s.agents.get(agent)
        if rec is not None:
            rec.status = AgentStatusValue(status) if not isinstance(status, AgentStatusValue) else status

    async def write_agent_output(
        self, *, session_id: str, agent: Any, payload: dict
    ) -> None:
        key = (session_id, agent.value if hasattr(agent, "value") else str(agent))
        self.outputs[key] = payload

    async def read_session(self, session_id: str) -> Any:
        return self.sessions.get(session_id)

    async def read_agent_output(self, session_id: str, agent: Any) -> dict | None:
        key = (session_id, agent.value if hasattr(agent, "value") else str(agent))
        return self.outputs.get(key)

    async def find_existing_session_by_idempotency_key(
        self, *, uid: str, key: str
    ) -> Any:
        sid = self.idempotency.get((uid, key))
        if sid is None:
            return None
        return self.sessions.get(sid)

    async def cancel_session(self, session_id: str) -> None:
        from models.session_models import SessionStatus
        s = self.sessions.get(session_id)
        if s is not None:
            s.status = SessionStatus.CANCELED
            s.canceled_at = datetime.now(tz=timezone.utc)
        self.canceled.add(session_id)

    async def get_user_companies(self, uid: str) -> list:
        return [s for s in self.sessions.values() if s.user_uid == uid]

    async def list_branches_for_session(self, session_id: str) -> list:
        return [s for s in self.sessions.values() if s.parent_session_id == session_id]

    async def record_usage(self, *, uid: str, period: str, tokens: int, cost_usd: float) -> None:
        return None

    async def tombstone_session(self, session_id: str) -> None:
        self.tombstoned.add(session_id)

    async def get_user(self, uid: str) -> Any:
        return self.users.get(uid)

    async def ensure_user(self, *, uid: str, email: str | None = None,
                          is_anonymous: bool = False, locale: str = "en-US",
                          region: str = "US") -> None:
        if uid not in self.users:
            from models.billing_models import SubscriptionTier
            from models.user_models import User, UserRole
            self.users[uid] = User(
                uid=uid,
                email=email,
                role=UserRole.USER,
                tier=SubscriptionTier.FOUNDER,
                created_at=datetime.now(tz=timezone.utc),
                locale=locale,
                region=region,
            )

    async def update_user(self, uid: str, updates: dict) -> Any:
        u = self.users.get(uid)
        if u is None:
            await self.ensure_user(uid=uid)
            u = self.users[uid]
        for k, v in updates.items():
            if k == "consent":
                u.consent.update(v)
            else:
                setattr(u, k, v)
        return u

    async def cascade_delete_user(self, uid: str) -> None:
        for sid in [s.session_id for s in self.sessions.values() if s.user_uid == uid]:
            self.tombstoned.add(sid)
        self.users.pop(uid, None)

    async def stripe_event_already_processed(self, event_id: str) -> bool:
        return event_id in self.processed_stripe_events

    async def mark_stripe_event_processed(self, event_id: str, event_type: str) -> None:
        self.processed_stripe_events.add(event_id)

    async def list_active_companies(self) -> list:
        return []

    async def create_marketplace_job(
        self,
        *,
        uid: str,
        company_id: str,
        job_type: str,
        session_id: str | None,
        status: str,
    ) -> str:
        return f"job_test_{company_id}"


@pytest.fixture
def in_memory_firestore() -> _InMemoryFirestore:
    return _InMemoryFirestore()


@pytest.fixture
def mock_firestore(monkeypatch: pytest.MonkeyPatch, in_memory_firestore: _InMemoryFirestore):
    """Replace services.firestore_service with the in-memory shim."""
    from services import firestore_service

    for attr in [
        "create_session",
        "update_session_status",
        "update_agent_status",
        "write_agent_output",
        "read_session",
        "read_agent_output",
        "find_existing_session_by_idempotency_key",
        "cancel_session",
        "get_user_companies",
        "list_branches_for_session",
        "record_usage",
        "tombstone_session",
        "get_user",
        "ensure_user",
        "update_user",
        "cascade_delete_user",
        "stripe_event_already_processed",
        "mark_stripe_event_processed",
        "list_active_companies",
        "create_marketplace_job",
    ]:
        monkeypatch.setattr(
            firestore_service,
            attr,
            getattr(in_memory_firestore, attr),
            raising=False,
        )
    return in_memory_firestore


# ─── gemini mock ─────────────────────────────────────────────────────────────


@pytest.fixture
def mock_gemini(monkeypatch: pytest.MonkeyPatch):
    """Replaces services.gemini_client.call_gemini_structured.

    Returns a callable that lets each test register a per-agent canned response.
    Default returns deterministic schema-shaped sample data.
    """
    canned: dict[str, Any] = {}

    async def _call(*, model: str, prompt: str, response_schema, grounded: bool = False,
                    temperature: float = 0.4):
        schema_name = response_schema.__name__
        if schema_name in canned:
            payload = canned[schema_name]
        else:
            payload = _default_for_schema(schema_name)
        # (raw_dict, in_tokens, out_tokens, blocked)
        return payload, 1200, 800, False

    from services import gemini_client
    monkeypatch.setattr(gemini_client, "call_gemini_structured", _call, raising=False)

    def register(schema_name: str, payload: dict) -> None:
        canned[schema_name] = payload

    register.canned = canned  # type: ignore[attr-defined]
    return register


def _default_for_schema(schema_name: str) -> dict:
    """Schema-shaped happy-path samples used by agent unit tests."""
    samples: dict[str, dict] = {
        "ParsedIdea": {
            "idea_summary": "A SaaS platform that automates inventory reconciliation for indie e-commerce sellers.",
            "industry": "saas",
            "product_type": "saas",
            "target_market": "Indie e-commerce sellers on Shopify and Amazon",
            "geography": "Global",
            "key_differentiator": "Auto-recon across 8 channels in under 30s using event-sourced ledger",
            "data_collection": True,
            "regulated_data": False,
            "brand_personality_hints": "trustworthy, fast, no-nonsense",
            "moderation_flags": [],
        },
        "ArticulationOutput": {
            "polished_idea": "A SaaS that reconciles inventory across e-commerce channels in real time.",
            "clarifying_questions": ["Which channels are priority?"],
            "assumptions": ["Sellers use at least 3 channels"],
            "confidence": 0.82,
        },
        "MarketResearchResult": {
            "tam": {"label": "TAM", "value": 24_000_000_000, "unit": "USD",
                    "confidence": "sourced",
                    "source": {"text": "Statista 2025", "source_url": "https://example.com/stat",
                               "publisher": "Statista", "accessed_at": "2026-05-01"}},
            "sam": {"label": "SAM", "value": 4_000_000_000, "unit": "USD",
                    "confidence": "derived", "derivation": "TAM * 0.16"},
            "som": {"label": "SOM", "value": 50_000_000, "unit": "USD",
                    "confidence": "estimated"},
            "cagr": {"label": "CAGR", "value": 14.2, "unit": "pct", "confidence": "sourced",
                     "source": {"text": "Grand View 2024", "source_url": "https://example.com/gv",
                                "publisher": "Grand View"}},
            "industry_trends": [
                "Shift to omnichannel inventory",
                "Headless commerce growth",
                "Real-time data adoption",
            ],
            "target_demographics": ["Indie sellers $50K-$5M GMV", "Small ops teams (<10)"],
            "market_timing_score": 7.4,
            "market_timing_rationale": "Channel proliferation outpaces tooling.",
            "sources": [
                {"text": "Statista 2025", "source_url": "https://example.com/a", "publisher": "Statista"},
                {"text": "Grand View", "source_url": "https://example.com/b", "publisher": "GVR"},
                {"text": "Forrester", "source_url": "https://example.com/c", "publisher": "Forrester"},
            ],
        },
        "CompetitiveAnalysisResult": {
            "competitors": [
                {"name": "InventoryPro", "url": "https://example.com/ip", "description": "incumbent",
                 "strengths": ["Big customer base"], "weaknesses": ["Slow"], "data_disclosed": True},
                {"name": "StockSync", "url": "https://example.com/ss", "description": "challenger",
                 "strengths": ["Cheap"], "weaknesses": ["Few channels"], "data_disclosed": True},
                {"name": "ChannelHub", "url": "https://example.com/ch", "description": "platform",
                 "strengths": ["Wide integrations"], "weaknesses": ["Hard to set up"], "data_disclosed": True},
            ],
            "feature_matrix": {
                "real_time_sync": {"InventoryPro": False, "StockSync": True, "ChannelHub": True},
            },
            "positioning_gaps": ["No real-time + indie-friendly tier", "No event-sourced model"],
            "market_concentration": "fragmented",
            "sources": [
                {"text": "G2", "source_url": "https://example.com/g2", "publisher": "G2"},
                {"text": "Capterra", "source_url": "https://example.com/cap", "publisher": "Capterra"},
                {"text": "TechCrunch", "source_url": "https://example.com/tc", "publisher": "TC"},
            ],
        },
        "BusinessModelResult": {
            "revenue_model": "Subscription tiered by GMV",
            "pricing_tiers": [
                {"name": "Starter", "price_usd_monthly": 29, "features": ["3 channels"], "target_segment": "Solo"},
                {"name": "Growth", "price_usd_monthly": 99, "features": ["8 channels", "alerts"], "target_segment": "SMB"},
            ],
            "unit_economics": {
                "cac_usd": {"label": "CAC", "value": 120, "unit": "USD", "confidence": "estimated"},
                "ltv_usd": {"label": "LTV", "value": 1800, "unit": "USD", "confidence": "estimated"},
                "gross_margin_pct": {"label": "GM", "value": 82, "unit": "pct", "confidence": "estimated"},
                "payback_months": {"label": "Payback", "value": 6, "unit": "months", "confidence": "estimated"},
                "ltv_cac_ratio": 15.0,
            },
            "business_model_canvas": {"customer_segments": ["Indie sellers"]},
            "primary_revenue_stream": "Monthly subscription",
        },
        "BrandIdentityResult": {
            "company_name": "Tally",
            "tagline": "Inventory in one breath.",
            "brand_voice_traits": ["calm", "direct", "trustworthy"],
            "brand_voice_sample_copy": "Stop guessing what's in stock.",
            "color_palette": [
                {"name": "Ink", "hex": "#0F172A", "role": "primary"},
                {"name": "Mint", "hex": "#10B981", "role": "accent"},
                {"name": "Bone", "hex": "#F8FAFC", "role": "background"},
            ],
            "typography": {"heading_font": "GT America", "body_font": "Inter"},
            "logo_concept_description": "Mono wordmark with subtle ledger underline.",
            "industry_keywords": ["inventory", "ecommerce"],
        },
        "RiskAnalysisResult": {
            "risk_matrix": [
                {"category": "market", "description": "Slow to adopt", "probability": "medium",
                 "impact": "medium", "mitigation": "Free tier"},
                {"category": "execution", "description": "Channel API churn", "probability": "high",
                 "impact": "medium", "mitigation": "Adapter pattern"},
                {"category": "regulatory", "description": "GDPR data egress", "probability": "low",
                 "impact": "high", "mitigation": "EU region option"},
                {"category": "technical", "description": "Sync conflicts", "probability": "high",
                 "impact": "medium", "mitigation": "Event-sourced ledger"},
                {"category": "financial", "description": "CAC creep", "probability": "medium",
                 "impact": "medium", "mitigation": "Content moat"},
            ],
            "regulatory_considerations": {"US": ["CCPA"], "EU": ["GDPR"]},
            "worst_case_scenario": "Major channel revokes API access overnight.",
            "pivot_options": ["Pivot to wholesale ops tooling", "Pivot to financial reconciliation"],
        },
        "TechArchitectureResult": {
            "recommended_stack": {"frontend": "Next.js", "backend": "FastAPI", "db": "Postgres",
                                  "hosting": "Cloud Run"},
            "architecture_diagram_mermaid": "graph TD; A[Web]-->B[API]-->C[(DB)]",
            "mvp_core_features": ["3 channel sync", "Reconciliation", "Alert"],
            "mvp_nice_to_have": ["Forecasting"],
            "estimated_dev_weeks": 14,
            "estimated_team_size": 3,
            "monthly_infra_cost_usd_estimate": {"label": "Infra", "value": 380, "unit": "USD",
                                                "confidence": "estimated"},
            "security_considerations": ["OAuth scopes", "Encryption at rest", "Audit logs"],
        },
        "FinancialModelResult": {
            "assumptions": {"start_users": 50, "growth_mom": 0.18, "arpu": 79, "cogs_pct": 0.18,
                            "opex_year_1": 480_000, "headcount_year_1": 4},
            "projections": [
                {"year": 1, "revenue_usd": 250_000, "cogs_usd": 45_000, "gross_profit_usd": 205_000,
                 "opex_usd": 480_000, "ebitda_usd": -275_000, "headcount": 4, "cash_usd": 1_000_000},
                {"year": 2, "revenue_usd": 1_400_000, "cogs_usd": 252_000, "gross_profit_usd": 1_148_000,
                 "opex_usd": 1_100_000, "ebitda_usd": 48_000, "headcount": 9, "cash_usd": 800_000},
                {"year": 3, "revenue_usd": 4_900_000, "cogs_usd": 882_000, "gross_profit_usd": 4_018_000,
                 "opex_usd": 2_300_000, "ebitda_usd": 1_718_000, "headcount": 18, "cash_usd": 2_500_000},
            ],
            "funding_seed_usd": 1_000_000,
            "runway_months": 22.0,
            "breakeven_month": 18,
            "key_metrics": {"ltv_cac": 15.0, "rule_of_40": 38.0},
            "reconciliation_passed": True,
        },
        "LandingPageResult": {
            "html_sanitized": "<section><h1>Tally</h1><p>Inventory, reconciled.</p></section>",
            "css": "section{padding:4rem}",
            "title": "Tally — Inventory in one breath",
            "meta_description": "Real-time multi-channel inventory.",
            "og_tags": {"og:title": "Tally"},
        },
        "LegalDocumentsResult": {
            "tos_template_id": "termly_saas_v3",
            "privacy_template_id": "termly_priv_v3",
            "incorporation_checklist": [{"step": "Delaware C-Corp", "status": "todo"}],
            "jurisdictions_covered": ["US"],
            "lawyer_review_cta": True,
        },
        "GoToMarketResult": {
            "launch_strategy_type": "product_hunt",
            "launch_phases": [{"phase": "soft", "weeks": "1-2", "actions": "private beta"}],
            "marketing_channels": [{"channel": "content", "cac_estimate": 80, "priority": 1}],
            "first_90_days_plan": {"weeks_1_4": ["Beta"], "weeks_5_8": ["PH launch"], "weeks_9_12": ["SEO"]},
            "kpis": {"signups": {"3mo": 1000, "12mo": 12000}},
            "partnerships": ["Shopify"],
        },
        "PitchDeckResult": {
            "slides": [
                {"slide_number": i, "layout": layout, "title": f"Slide {i}",
                 "body": "body", "speaker_notes": "notes"}
                for i, layout in enumerate(
                    ["title", "problem", "solution", "market", "business_model",
                     "traction", "competition", "gtm", "financials", "team", "ask", "contact"], 1
                )
            ],
        },
        "ExecutiveSummaryResult": {
            "summary_text": " ".join(["word"] * 120),
            "one_liner": "Tally reconciles indie e-commerce inventory in real time.",
            "elevator_pitch_30s": "30s pitch.",
            "elevator_pitch_60s": "60s pitch.",
            "key_highlights": ["Real-time", "Indie-friendly", "Event-sourced"],
            "coherence_score": 0.92,
        },
    }
    return samples.get(schema_name, {})


# ─── moderation / billing / cost / sse / etc. mocks ──────────────────────────


@pytest.fixture
def mock_services(monkeypatch: pytest.MonkeyPatch, fake_auth_user: Any):
    from services import (
        analytics_service,
        auth_service,
        billing_service,
        cost_service,
        deploy_service,
        export_service,
        moderation_service,
        notification_service,
        speech_service,
        sse_service,
    )

    # Auth
    async def _verify_id(_t: str) -> dict:
        return {"sub": fake_auth_user.uid, "uid": fake_auth_user.uid,
                "email": fake_auth_user.email, "firebase": {"sign_in_provider": "password"}}

    async def _verify_session(_t: str) -> dict:
        return {"sub": fake_auth_user.uid, "uid": fake_auth_user.uid,
                "email": fake_auth_user.email, "tier": fake_auth_user.tier,
                "role": fake_auth_user.role}

    async def _mint(*, uid: str, email: str | None = None, is_anonymous: bool = False,
                    extra_claims: dict | None = None) -> tuple[str, int]:
        return "session.jwt.test", 3600

    monkeypatch.setattr(auth_service, "verify_id_token", _verify_id, raising=False)
    monkeypatch.setattr(auth_service, "verify_session_jwt", _verify_session, raising=False)
    monkeypatch.setattr(auth_service, "mint_session_jwt", _mint, raising=False)

    # Moderation: allow by default
    class _Mod:
        def __init__(self) -> None:
            self.allowed = True
            self.categories: list[str] = []

    async def _pre(text: str):
        return _Mod()

    async def _post(out: Any):
        return out

    monkeypatch.setattr(moderation_service, "pre_filter_input", _pre, raising=False)
    monkeypatch.setattr(moderation_service, "post_filter_output", _post, raising=False)

    # Billing
    async def _tier(uid: str) -> str:
        return fake_auth_user.tier

    monkeypatch.setattr(billing_service, "get_user_tier", _tier, raising=False)

    # Cost
    async def _check(*, uid: str, period: str) -> int:
        return 0

    async def _get_cost(_sid: str) -> float:
        return 0.0

    async def _record_cost(**_kw: Any) -> None:
        return None

    monkeypatch.setattr(cost_service, "check_budget", _check, raising=False)
    monkeypatch.setattr(cost_service, "get_session_cost", _get_cost, raising=False)
    monkeypatch.setattr(cost_service, "record_cost", _record_cost, raising=False)

    # SSE
    queues: dict[str, asyncio.Queue] = {}

    async def _publish(session_id: str, event: dict) -> None:
        q = queues.setdefault(session_id, asyncio.Queue())
        await q.put(event)

    async def _subscribe(session_id: str):
        q = queues.setdefault(session_id, asyncio.Queue())
        while True:
            event = await q.get()
            if event is None:
                return
            yield event
            if event.get("event") == "terminal":
                return

    monkeypatch.setattr(sse_service, "publish", _publish, raising=False)
    monkeypatch.setattr(sse_service, "subscribe", _subscribe, raising=False)

    # Notifications + analytics: no-ops
    async def _send_email(**_kw: Any) -> None:
        return None

    async def _track(**_kw: Any) -> None:
        return None

    monkeypatch.setattr(notification_service, "send_completion_email", _send_email, raising=False)
    monkeypatch.setattr(analytics_service, "track", _track, raising=False)

    # Speech
    async def _transcribe(**_kw: Any) -> dict:
        return {"text": "A startup that automates X.", "duration_seconds": 4.2, "language": "en"}

    monkeypatch.setattr(speech_service, "transcribe_audio", _transcribe, raising=False)

    # Export
    async def _exp(**_kw: Any) -> dict:
        return {"url": "https://example.com/export"}

    for fn_name in ("export_to_drive", "export_to_notion", "export_to_markdown_zip",
                    "export_to_pptx", "export_to_json"):
        monkeypatch.setattr(export_service, fn_name, _exp, raising=False)

    # Deploy
    async def _deploy(**_kw: Any) -> dict:
        return {"url": "https://acme.prometheus.app"}

    async def _provision(**_kw: Any) -> None:
        return None

    monkeypatch.setattr(deploy_service, "deploy_landing_page", _deploy, raising=False)
    monkeypatch.setattr(deploy_service, "provision_domain", _provision, raising=False)


@pytest_asyncio.fixture
async def app(mock_services, mock_firestore):
    """FastAPI app with all external services mocked.

    `mock_services` and `mock_firestore` are required so module-level imports
    inside route handlers see the patched service modules.
    """
    # main is imported here so monkeypatches are applied before app construction.
    import main as main_module
    return main_module.create_app()


@pytest_asyncio.fixture
async def client(app, fake_auth_user) -> AsyncIterator:
    import httpx
    from httpx import ASGITransport

    transport = ASGITransport(app=app)
    headers = {
        "authorization": "Bearer test.session.jwt",
        "x-request-id": "req_test_0001",
    }
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver",
                                 headers=headers) as ac:
        yield ac


# ─── golden ideas ────────────────────────────────────────────────────────────


@pytest.fixture
def golden_ideas() -> list[dict]:
    path = Path(__file__).parent / "golden" / "ideas.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


# ─── pytest plugins / asyncio mode ───────────────────────────────────────────


def pytest_collection_modifyitems(config: Any, items: list[Any]) -> None:
    for item in items:
        if "test_golden" in item.nodeid or "@pytest.mark.golden" in str(item.function):
            item.add_marker(pytest.mark.golden)
