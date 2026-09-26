"""Validation gate unit tests."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


def _populated_wave1() -> dict:
    from models.agent_schemas import (
        BrandIdentityResult,
        BusinessModelResult,
        CompetitiveAnalysisResult,
        MarketResearchResult,
        ParsedIdea,
        RiskAnalysisResult,
        TechArchitectureResult,
    )
    from tests.conftest import _default_for_schema

    parsed = ParsedIdea.model_validate(_default_for_schema("ParsedIdea"))
    market = MarketResearchResult.model_validate(_default_for_schema("MarketResearchResult"))
    comp = CompetitiveAnalysisResult.model_validate(_default_for_schema("CompetitiveAnalysisResult"))
    business = BusinessModelResult.model_validate(_default_for_schema("BusinessModelResult"))
    brand = BrandIdentityResult.model_validate(_default_for_schema("BrandIdentityResult"))
    risk = RiskAnalysisResult.model_validate(_default_for_schema("RiskAnalysisResult"))
    tech = TechArchitectureResult.model_validate(_default_for_schema("TechArchitectureResult"))
    return {
        "parsed_idea": parsed,
        "market_research_result": market,
        "competitive_analysis_result": comp,
        "business_model_result": business,
        "brand_identity_result": brand,
        "risk_analysis_result": risk,
        "tech_architecture_result": tech,
    }


def _populated_wave2() -> dict:
    from models.agent_schemas import (
        FinancialModelResult,
        GoToMarketResult,
        LandingPageResult,
        LegalDocumentsResult,
    )
    from tests.conftest import _default_for_schema

    fin = FinancialModelResult.model_validate(_default_for_schema("FinancialModelResult"))
    landing = LandingPageResult.model_validate(_default_for_schema("LandingPageResult"))
    landing = landing.model_copy(update={"html_sanitized": "<section>" + ("ok " * 80) + "</section>"})
    legal = LegalDocumentsResult.model_validate(_default_for_schema("LegalDocumentsResult"))
    gtm = GoToMarketResult.model_validate(_default_for_schema("GoToMarketResult"))
    return {
        "financial_model_result": fin,
        "landing_page_result": landing,
        "legal_documents_result": legal,
        "go_to_market_result": gtm,
    }


def _populated_wave3() -> dict:
    from models.agent_schemas import ExecutiveSummaryResult, PitchDeckResult
    from tests.conftest import _default_for_schema

    deck = PitchDeckResult.model_validate(_default_for_schema("PitchDeckResult"))
    exec_sum = ExecutiveSummaryResult.model_validate(_default_for_schema("ExecutiveSummaryResult"))
    return {"pitch_deck_result": deck, "executive_summary_result": exec_sum}


# ─── Wave 1 ──────────────────────────────────────────────────────────────────


async def test_wave_1_gate_happy(monkeypatch) -> None:
    from agents.gates import wave_1_gate
    from services import vertex_safety

    async def _check_text(_t):
        return {"blocked": False}

    monkeypatch.setattr(vertex_safety, "check_text", _check_text, raising=False)

    state = _populated_wave1()
    result = await wave_1_gate(state)
    assert result.passed is True
    # Palette has been hydrated with WCAG fields.
    brand = state["brand_identity_result"]
    assert brand.color_palette[0].contrast_on_white is not None
    assert brand.color_palette[0].wcag_aa_normal is not None


async def test_wave_1_gate_moderation_flagged() -> None:
    from agents.gates import wave_1_gate
    from models.agent_schemas import ParsedIdea
    from tests.conftest import _default_for_schema

    state = _populated_wave1()
    bad = dict(_default_for_schema("ParsedIdea"))
    bad["moderation_flags"] = ["weapons"]
    state["parsed_idea"] = ParsedIdea.model_validate(bad)
    result = await wave_1_gate(state)
    assert result.passed is False
    assert any(i.code == "MODERATION_FLAGGED" for i in result.issues)


async def test_wave_1_gate_uspto_conflict_rejects() -> None:
    from agents.gates import wave_1_gate
    from models.agent_schemas import BrandIdentityResult, NameCandidate

    state = _populated_wave1()
    brand: BrandIdentityResult = state["brand_identity_result"]
    bad_alt = NameCandidate(
        name=brand.company_name,
        rationale="primary",
        uspto_conflicts=["MarkOwner Inc."],
        domain_com_available=False,
    )
    state["brand_identity_result"] = brand.model_copy(update={"name_alternatives": [bad_alt]})
    result = await wave_1_gate(state)
    # USPTO conflict surfaces as an issue (DOMAIN unavailable becomes a warning).
    assert any(i.code == "USPTO_CONFLICT" for i in result.issues)


async def test_wave_1_gate_wcag_fails_on_low_contrast() -> None:
    from agents.gates import wave_1_gate
    from models.agent_schemas import BrandIdentityResult, ColorEntry

    state = _populated_wave1()
    brand: BrandIdentityResult = state["brand_identity_result"]
    # Yellow primary + white text → ratio < 4.5 → AA fail
    bad = [
        ColorEntry(name="Yellow", hex="#FFEB3B", role="primary"),
        ColorEntry(name="White", hex="#FFFFFF", role="text"),
        ColorEntry(name="Bone", hex="#F8FAFC", role="background"),
    ]
    state["brand_identity_result"] = brand.model_copy(update={"color_palette": bad})
    result = await wave_1_gate(state)
    assert any(i.code == "WCAG_AA_FAIL" for i in result.issues)


async def test_wave_1_gate_palette_hydration_writes_back() -> None:
    """The gate mutates state with a hydrated palette so downstream agents can reuse."""
    from agents.gates import wave_1_gate

    state = _populated_wave1()
    pre = state["brand_identity_result"].color_palette[0]
    # contrast_on_white begins None.
    assert pre.contrast_on_white is None
    await wave_1_gate(state)
    post = state["brand_identity_result"].color_palette[0]
    assert post.contrast_on_white is not None


# ─── Wave 2 ──────────────────────────────────────────────────────────────────


async def test_wave_2_gate_happy(monkeypatch) -> None:
    from agents.gates import wave_2_gate
    from services import sanitization, vertex_safety

    async def _check_text(_t):
        return {"blocked": False}

    monkeypatch.setattr(vertex_safety, "check_text", _check_text, raising=False)
    monkeypatch.setattr(
        sanitization, "sanitize_html", lambda h: "<section>" + ("ok " * 80) + "</section>", raising=False
    )

    state = _populated_wave2()
    result = await wave_2_gate(state)
    assert result.passed is True


async def test_wave_2_gate_finance_not_reconciled() -> None:
    from agents.gates import wave_2_gate

    state = _populated_wave2()
    state["financial_model_result"] = state["financial_model_result"].model_copy(
        update={"reconciliation_passed": False}
    )
    result = await wave_2_gate(state)
    assert any(i.code == "FINANCE_NOT_RECONCILED" for i in result.issues)


async def test_wave_2_gate_landing_too_small(monkeypatch) -> None:
    from agents.gates import wave_2_gate
    from services import sanitization

    monkeypatch.setattr(sanitization, "sanitize_html", lambda h: "<p>tiny</p>", raising=False)
    state = _populated_wave2()
    result = await wave_2_gate(state)
    assert any(i.code == "LANDING_EMPTY" for i in result.issues)


async def test_wave_2_gate_landing_html_re_sanitized(monkeypatch) -> None:
    """Sanitizer is called even if agent already sanitized — defense in depth."""
    from agents.gates import wave_2_gate

    calls = {"n": 0}
    cleaned = "<section>" + ("ok " * 80) + "</section>"

    def _san(html: str) -> str:
        calls["n"] += 1
        return cleaned

    from services import sanitization

    monkeypatch.setattr(sanitization, "sanitize_html", _san, raising=False)
    state = _populated_wave2()
    await wave_2_gate(state)
    assert calls["n"] == 1
    assert state["landing_page_result"].html_sanitized == cleaned


async def test_wave_2_gate_legal_no_lawyer_cta() -> None:
    from agents.gates import wave_2_gate

    state = _populated_wave2()
    state["legal_documents_result"] = state["legal_documents_result"].model_copy(
        update={"lawyer_review_cta": False}
    )
    result = await wave_2_gate(state)
    assert any(i.code == "LEGAL_NO_LAWYER_CTA" for i in result.issues)


# ─── Wave 3 ──────────────────────────────────────────────────────────────────


async def test_wave_3_gate_happy(monkeypatch) -> None:
    from agents.gates import wave_3_gate
    from services import vertex_safety

    async def _check_text(_t):
        return {"blocked": False}

    monkeypatch.setattr(vertex_safety, "check_text", _check_text, raising=False)
    state = {**_populated_wave1(), **_populated_wave3()}
    result = await wave_3_gate(state)
    assert result.passed is True


async def test_wave_3_gate_low_coherence_warns() -> None:
    from agents.gates import wave_3_gate

    state = {**_populated_wave1(), **_populated_wave3()}
    state["executive_summary_result"] = state["executive_summary_result"].model_copy(
        update={"coherence_score": 0.3}
    )
    result = await wave_3_gate(state)
    # Low coherence is a warning, not a hard block.
    assert any(w.code == "LOW_COHERENCE" for w in result.warnings)


async def test_wave_3_gate_deck_slide_count_violation() -> None:
    from agents.gates import wave_3_gate
    from models.agent_schemas import PitchDeckResult, PitchSlide

    # Create an 8-slide deck (must be 10–14)
    short_deck = PitchDeckResult.model_construct(
        slides=[
            PitchSlide(
                slide_number=i,
                layout="title" if i == 1 else "problem",
                title=f"S{i}",
                body="b",
                speaker_notes="n",
            )
            for i in range(1, 9)
        ]
    )
    state = {**_populated_wave1(), **_populated_wave3()}
    state["pitch_deck_result"] = short_deck

    # Bypass Pydantic construction to check the gate's independent guard.
    result = await wave_3_gate(state)
    assert result.passed is False
    assert any(issue.code == "DECK_SLIDE_COUNT" for issue in result.issues)
