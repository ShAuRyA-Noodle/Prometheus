"""Auth: Firebase ID token verification + short-lived backend session JWTs.

* ``verify_id_token(token)`` — verifies a Firebase Auth ID token, looks up /
  upserts the corresponding ``User`` in Firestore, returns it.
* ``mint_session_jwt(uid, session_id)`` — issues a 5-minute HS256 JWT scoped
  to (sub=uid, session_id, aud=backend). Used to authorize SSE subscriptions.
* ``verify_session_jwt(token)`` — validates a backend session JWT.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import jwt
import structlog

from config import settings
from models.user_models import User, UserRole

log = structlog.get_logger(__name__)


_JWT_ALG = "HS256"
_JWT_AUD = "prometheus-backend"
_JWT_ISS = "prometheus"
_JWT_TTL_SECONDS = 5 * 60


# ─── Firebase Admin init ─────────────────────────────────────────────────────


def _ensure_firebase() -> None:
    import firebase_admin  # type: ignore[import-not-found]

    if firebase_admin._apps:
        return
    try:
        firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})
    except Exception as e:  # noqa: BLE001
        log.warning("auth.firebase_init_err", err=str(e))
        firebase_admin.initialize_app()


# ─── Public API ──────────────────────────────────────────────────────────────


async def verify_id_token(token: str) -> User:
    """Validates a Firebase ID token, returns a fresh User record. Raises
    ``ValueError`` on any verification failure."""

    def _verify_sync() -> dict[str, Any]:
        from firebase_admin import auth as fb_auth  # type: ignore[import-not-found]

        _ensure_firebase()
        try:
            # check_revoked True forces revocation lookup
            decoded = fb_auth.verify_id_token(token, check_revoked=True)
            return decoded
        except Exception as e:  # noqa: BLE001
            log.warning("auth.id_token_invalid", err=str(e))
            raise ValueError("invalid id token") from e

    decoded = await asyncio.to_thread(_verify_sync)

    uid = str(decoded.get("uid") or decoded.get("user_id") or "")
    email = decoded.get("email")
    display_name = decoded.get("name")
    if not uid:
        raise ValueError("no uid in id token")

    # Read existing record (avoids overwriting tier/customer_id)
    from services import firestore_service  # local import to avoid cycle

    existing = await firestore_service.get_user(uid)
    if existing is None:
        new_user = User(
            uid=uid,
            email=email,
            display_name=display_name,
            role=UserRole.USER,
            created_at=datetime.now(timezone.utc),
            last_active_at=datetime.now(timezone.utc),
        )
        await firestore_service.upsert_user(new_user)
        return new_user

    existing.last_active_at = datetime.now(timezone.utc)
    if email and not existing.email:
        existing.email = email
    if display_name and not existing.display_name:
        existing.display_name = display_name
    await firestore_service.upsert_user(existing)
    return existing


def mint_session_jwt(uid: str, session_id: str) -> str:
    now = int(time.time())
    payload = {
        "iss": _JWT_ISS,
        "aud": _JWT_AUD,
        "sub": uid,
        "session_id": session_id,
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
        "nbf": now - 5,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_JWT_ALG)


def verify_session_jwt(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=[_JWT_ALG],
            audience=_JWT_AUD,
            issuer=_JWT_ISS,
            options={"require": ["exp", "iat", "sub", "session_id"]},
        )
    except jwt.PyJWTError as e:
        log.warning("auth.session_jwt_invalid", err=str(e))
        raise ValueError("invalid session jwt") from e


__all__ = ["mint_session_jwt", "verify_id_token", "verify_session_jwt"]
