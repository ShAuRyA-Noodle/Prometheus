"""Signed share-token mint/verify (HS256 JWT).

Tokens carry: ``{session_id, scope, exp, view_id, iat}``. Scopes:
  - ``deck``       — pitch deck only
  - ``summary``    — exec summary only
  - ``landing``    — landing page only
  - ``full``       — everything

View tracking: ``track_view(token, viewer_meta)`` writes to
``shares/{token_jti}/views/{auto-id}`` for the InvestorAnalytics dashboard.
"""
from __future__ import annotations

import asyncio
import binascii
import hashlib
import hmac
import json
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timezone
from typing import Any, Literal

import structlog
from pydantic import BaseModel, Field

from config import settings

log = structlog.get_logger(__name__)


ShareScope = Literal["deck", "summary", "landing", "full"]


# ─── Models ──────────────────────────────────────────────────────────────────


class ShareClaims(BaseModel):
    session_id: str
    scope: ShareScope
    exp: int
    iat: int
    view_id: str  # JTI used as the share doc id
    minted_by: str | None = None


class ViewerMeta(BaseModel):
    ip: str | None = None
    user_agent: str | None = None
    referrer: str | None = None
    country: str | None = None
    city: str | None = None
    is_bot: bool = False
    organization: str | None = None  # reverse-DNS lookup (best-effort)


class ShareView(BaseModel):
    view_id: str
    viewed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    meta: ViewerMeta


# ─── Crypto helpers ──────────────────────────────────────────────────────────


def _secret() -> bytes:
    return (settings.share_token_secret or settings.secret_key).encode("utf-8")


def _b64u(b: bytes) -> str:
    return urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return urlsafe_b64decode((s + pad).encode("ascii"))


def _sign(payload: bytes) -> bytes:
    return hmac.new(_secret(), payload, hashlib.sha256).digest()


# ─── API ─────────────────────────────────────────────────────────────────────


def mint(
    session_id: str,
    scope: ShareScope = "full",
    ttl_days: int | None = None,
    minted_by: str | None = None,
) -> str:
    """Create a signed JWT (HS256). Caller persists nothing — verify is stateless."""
    ttl = ttl_days if ttl_days is not None else settings.share_token_ttl_days
    now = int(time.time())
    view_id = secrets.token_urlsafe(12)
    payload = {
        "session_id": session_id,
        "scope": scope,
        "iat": now,
        "exp": now + ttl * 86400,
        "view_id": view_id,
        "minted_by": minted_by,
    }
    header = {"alg": "HS256", "typ": "JWT"}

    h = _b64u(json.dumps(header, separators=(",", ":")).encode())
    p = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{h}.{p}".encode("ascii")
    sig = _b64u(_sign(signing_input))
    token = f"{h}.{p}.{sig}"
    log.info(
        "share.mint",
        session_id=session_id,
        scope=scope,
        view_id=view_id,
        ttl_days=ttl,
    )
    return token


def verify(token: str) -> ShareClaims | None:
    """Verify HS256 signature, expiry, and revocation. Returns None on any failure."""
    try:
        h, p, s = token.split(".")
    except ValueError:
        return None

    try:
        signing_input = f"{h}.{p}".encode("ascii")
        actual = _b64u_decode(s)
    except (UnicodeError, ValueError, binascii.Error):
        return None
    expected = _sign(signing_input)
    if not hmac.compare_digest(expected, actual):
        log.warning("share.verify.bad_signature")
        return None

    try:
        payload = json.loads(_b64u_decode(p))
    except Exception:  # noqa: BLE001
        return None

    try:
        claims = ShareClaims.model_validate(payload)
    except Exception:  # noqa: BLE001
        return None

    if claims.exp < int(time.time()):
        log.info("share.verify.expired", view_id=claims.view_id)
        return None

    # Revocation check (sync best-effort; failures don't block)
    try:
        if _is_revoked(claims.view_id):
            log.info("share.verify.revoked", view_id=claims.view_id)
            return None
    except Exception:  # noqa: BLE001
        pass

    return claims


def _is_revoked(view_id: str) -> bool:
    try:
        from services.firestore_service import _get_db  # type: ignore[attr-defined]

        db = _get_db()
        snap = db.collection("shares").document(view_id).get()
        if not snap.exists:
            return False
        return bool((snap.to_dict() or {}).get("revoked", False))
    except Exception:  # noqa: BLE001
        return False


async def track_view(token: str, viewer: ViewerMeta) -> bool:
    """Persist a view event for the share token. Returns True if recorded."""
    claims = verify(token)
    if claims is None:
        return False

    def _w() -> None:
        from services.firestore_service import _get_db  # type: ignore[attr-defined]

        db = _get_db()
        ref = db.collection("shares").document(claims.view_id)
        ref.set(
            {
                "session_id": claims.session_id,
                "scope": claims.scope,
                "minted_at": claims.iat,
                "exp": claims.exp,
                "first_viewed_at": datetime.now(timezone.utc),
            },
            merge=True,
        )
        ref.collection("views").add(
            {
                "viewed_at": datetime.now(timezone.utc),
                **viewer.model_dump(mode="json"),
            }
        )
        # Increment counter
        from google.cloud import firestore as gcfs  # type: ignore[import-not-found]

        ref.update({"view_count": gcfs.Increment(1)})

    try:
        await asyncio.to_thread(_w)
        log.info("share.view.tracked", session=claims.session_id, view_id=claims.view_id)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("share.view.track_failed", err=str(e))
        return False


async def revoke(token_or_view_id: str) -> bool:
    """Mark a token as revoked. Accepts a JWT or a view_id directly."""
    view_id = token_or_view_id
    if "." in token_or_view_id:
        claims = verify(token_or_view_id)
        if claims is None:
            return False
        view_id = claims.view_id

    def _w() -> None:
        from services.firestore_service import _get_db  # type: ignore[attr-defined]

        db = _get_db()
        db.collection("shares").document(view_id).set(
            {"revoked": True, "revoked_at": datetime.now(timezone.utc)}, merge=True
        )

    try:
        await asyncio.to_thread(_w)
        log.info("share.revoke", view_id=view_id)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("share.revoke_failed", err=str(e))
        return False


async def list_views(view_id: str, limit: int = 100) -> list[ShareView]:
    """Return view events for a given share doc."""

    def _r() -> list[dict[str, Any]]:
        from services.firestore_service import _get_db  # type: ignore[attr-defined]

        db = _get_db()
        q = (
            db.collection("shares")
            .document(view_id)
            .collection("views")
            .order_by("viewed_at", direction="DESCENDING")
            .limit(limit)
        )
        return [d.to_dict() | {"id": d.id} for d in q.stream()]

    rows = await asyncio.to_thread(_r)
    out: list[ShareView] = []
    for r in rows:
        try:
            out.append(
                ShareView(
                    view_id=r.get("id", ""),
                    viewed_at=r.get("viewed_at") or datetime.now(timezone.utc),
                    meta=ViewerMeta.model_validate(r),
                )
            )
        except Exception:  # noqa: BLE001
            continue
    return out


__all__ = [
    "ShareClaims",
    "ShareScope",
    "ShareView",
    "ViewerMeta",
    "list_views",
    "mint",
    "revoke",
    "track_view",
    "verify",
]
