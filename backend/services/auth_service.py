"""Firebase ID-token verification and short-lived backend session JWTs."""

from __future__ import annotations

import asyncio
import time
from typing import Any, cast

import firebase_admin  # type: ignore[import-untyped]
import jwt
import structlog
from firebase_admin import auth as fb_auth

from config import settings

log = structlog.get_logger(__name__)

_JWT_ALG = "HS256"
_JWT_AUD = "prometheus-backend"
_JWT_ISS = "prometheus"
_JWT_TTL_SECONDS = 5 * 60


def _ensure_firebase() -> None:
    if firebase_admin._apps:
        return
    try:
        firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})
    except Exception as exc:  # noqa: BLE001
        log.warning("auth.firebase_init_err", err=str(exc))
        firebase_admin.initialize_app()


async def verify_id_token(token: str) -> dict[str, Any]:
    """Return verified Firebase claims; never return an unverified payload."""

    def _verify_sync() -> dict[str, Any]:
        _ensure_firebase()
        try:
            decoded = fb_auth.verify_id_token(token, check_revoked=True)
        except Exception as exc:
            log.warning("auth.id_token_invalid", err=str(exc))
            raise ValueError("invalid id token") from exc
        if not isinstance(decoded, dict):
            raise ValueError("invalid id token claims")
        claims = cast(dict[str, Any], decoded)
        if not (claims.get("uid") or claims.get("sub")):
            raise ValueError("no uid in id token")
        return claims

    return await asyncio.to_thread(_verify_sync)


async def mint_session_jwt(
    *,
    uid: str,
    email: str | None = None,
    is_anonymous: bool = False,
    extra_claims: dict[str, Any] | None = None,
) -> tuple[str, int]:
    """Mint the token consumed by AuthMiddleware and return its TTL."""
    now = int(time.time())
    payload: dict[str, Any] = {
        **(extra_claims or {}),
        "iss": _JWT_ISS,
        "aud": _JWT_AUD,
        "sub": uid,
        "uid": uid,
        "email": email,
        "anonymous": is_anonymous,
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
        "nbf": now - 5,
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=_JWT_ALG)
    return token, _JWT_TTL_SECONDS


async def verify_session_jwt(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=[_JWT_ALG],
            audience=_JWT_AUD,
            issuer=_JWT_ISS,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        log.warning("auth.session_jwt_invalid", err=str(exc))
        raise ValueError("invalid session jwt") from exc


__all__ = ["mint_session_jwt", "verify_id_token", "verify_session_jwt"]
