"""Legal document template-fill.

Per CLAUDE.md hard constraint: **no agent ever writes ToS/Privacy from scratch.**
This module reads vetted Jinja2 templates from ``backend/templates/legal/`` and
renders them with company-specific values. The output is always prefaced with
the AI-disclaimer block; ``lawyer_review_cta`` is enforced upstream.

Templates are jurisdiction-aware via Jinja conditionals
(``{% if "US" in jurisdictions %}``). The four supported keys are:
``US``, ``EU``, ``UK``, ``IN``.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger(__name__)


_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "legal"


_DISCLAIMER = (
    "> **AI-GENERATED DRAFT — NOT LEGAL ADVICE.**  \n"
    "> This document was assembled from a vetted template by an automated\n"
    "> system. It is a starting point only and must be reviewed by a\n"
    "> licensed attorney in each applicable jurisdiction before publication\n"
    "> or use. PROMETHEUS makes no representations as to its sufficiency\n"
    "> for any particular use case.\n\n"
)


_KNOWN_TYPES = ("tos", "privacy")


def _load_template(template_id: str) -> str:
    if template_id not in _KNOWN_TYPES:
        raise ValueError(f"unknown legal template: {template_id}")
    path = _TEMPLATE_DIR / f"{template_id}_template.md"
    if not path.exists():
        raise FileNotFoundError(f"legal template missing: {path}")
    return path.read_text(encoding="utf-8")


def fill_template(
    template_id: str,
    jurisdictions: list[str],
    company_name: str,
    business_model: str,
    data_collection: bool,
    regulated_data: bool,
    *,
    controller_email: str = "legal@example.com",
    controller_address: str = "TBD",
    effective_date: str = "TBD",
    extra_vars: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Render the requested template (``"tos"`` or ``"privacy"``) OR ``"all"``.

    Returns a dict ``{doc_type: rendered_md}``.
    """
    try:
        from jinja2 import Environment, StrictUndefined  # type: ignore[import-not-found]
    except Exception as e:  # noqa: BLE001
        log.error("legal_template.jinja_missing", err=str(e))
        raise

    env = Environment(
        # Values may be user supplied and the rendered Markdown may become HTML.
        autoescape=True,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
        undefined=StrictUndefined,
    )

    targets = _KNOWN_TYPES if template_id in ("all", "*") else (template_id,)

    base_vars: dict[str, Any] = {
        "company_name": company_name,
        "business_model": business_model,
        "data_collection": bool(data_collection),
        "regulated_data": bool(regulated_data),
        "jurisdictions": [j.upper() for j in jurisdictions],
        "controller_email": controller_email,
        "controller_address": controller_address,
        "effective_date": effective_date,
        "us": "US" in {j.upper() for j in jurisdictions},
        "eu": "EU" in {j.upper() for j in jurisdictions},
        "uk": "UK" in {j.upper() for j in jurisdictions},
        "in_": "IN" in {j.upper() for j in jurisdictions},  # 'in' is a reserved keyword
        "in": "IN" in {j.upper() for j in jurisdictions},
    }
    if extra_vars:
        base_vars.update(extra_vars)

    out: dict[str, str] = {}
    for t in targets:
        raw = _load_template(t)
        tpl = env.from_string(raw)
        body = tpl.render(**base_vars)
        out[t] = _DISCLAIMER + body
        log.info("legal_template.rendered", template=t, company=company_name)
    return out


__all__ = ["fill_template"]
