"""AuthMiddleware.

Verifies a Bearer token on every protected route. Two token kinds accepted:
  1. Firebase ID token (anonymous or full account) — verified via auth_service.verify_id_token.
  2. Session JWT (minted by /api/auth/anon|verify) — verified via auth_service.verify_session_jwt.

Anonymous routes:
    /health
    /api/auth/anon
    /api/billing/webhook  (Stripe-signed; routes_billing.py verifies signature)
    /sse/sessions/{id}    (token may be passed as ?token= query for EventSource)
    /docs, /openapi.json, /redoc  (only when settings.env == "dev")

Populates `request.state.user` with a typed `AuthedUser` dataclass.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import settings

log = structlog.get_logger("auth")


@dataclass(slots=True)
class AuthedUser:
    uid: str
    email: str | None
    is_anonymous: bool
    tier: str
    role: str
    raw_claims: dict[str, Any]


class AccountStoreUnavailableError(Exception):
    """Verified credentials could not be paired with a durable user record."""


_ANON_PATHS_EXACT = {
    "/",
    "/health",
    "/api/auth/anon",
    "/api/auth/verify",
    "/api/billing/webhook",
}
_ANON_PATH_PREFIXES = (
    "/openapi",
    "/docs",
    "/redoc",
)


def _is_anonymous_route(path: str, env: str) -> bool:
    if path in _ANON_PATHS_EXACT:
        return True
    if env == "dev" and any(path.startswith(p) for p in _ANON_PATH_PREFIXES):
        return True
    if path.startswith("/internal/"):
        # Internal routes use OIDC verification done inside the handler, not this middleware.
        return True
    return False


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _sse_query_token(request: Request) -> str | None:
    if request.url.path.startswith("/sse/"):
        return request.query_params.get("token")
    return None


def _err(status: int, code: str, message: str, request_id: str | None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"code": code, "message": message, "request_id": request_id},
    )


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        rid = getattr(request.state, "request_id", None)

        if _is_anonymous_route(path, settings.env):
            return await call_next(request)

        token = _bearer(request) or _sse_query_token(request)
        if not token:
            return _err(401, "UNAUTHORIZED", "missing bearer token", rid)

        try:
            user = await _resolve_user(token)
        except AccountStoreUnavailableError:
            log.error("auth.user_store_unavailable", request_id=rid)
            return _err(503, "USER_STORE_UNAVAILABLE", "could not save account", rid)
        except Exception as e:  # noqa: BLE001
            log.warning("auth.verify_failed", request_id=rid, err=str(e))
            return _err(401, "INVALID_AUTH", "token verification failed", rid)

        request.state.user = user
        return await call_next(request)


async def _resolve_user(token: str) -> AuthedUser:
    """Try session JWT first (cheap), fall back to Firebase ID token."""
    from services import auth_service, firestore_service

    firebase_verified = False
    try:
        claims = await auth_service.verify_session_jwt(token)
    except Exception:  # noqa: BLE001
        claims = await auth_service.verify_id_token(token)
        firebase_verified = True

    uid: str = claims["uid"] if "uid" in claims else claims["sub"]
    email = claims.get("email")
    is_anon = bool(
        claims.get("firebase", {}).get("sign_in_provider") == "anonymous" or claims.get("anonymous")
    )

    if firebase_verified:
        try:
            await firestore_service.ensure_user(uid=uid, email=email, is_anonymous=is_anon)
        except Exception as exc:
            raise AccountStoreUnavailableError from exc

    user_record = None
    try:
        user_record = await firestore_service.get_user(uid)
    except AttributeError:
        # Lookup helper isn't strictly required for auth — degrade gracefully.
        pass
    except Exception:  # noqa: BLE001
        log.warning("auth.user_lookup_failed", uid=uid)

    tier = (user_record.tier.value if user_record else None) or claims.get("tier") or "whisper"
    role = (user_record.role.value if user_record else None) or claims.get("role") or "user"

    return AuthedUser(
        uid=uid,
        email=email,
        is_anonymous=is_anon,
        tier=tier,
        role=role,
        raw_claims=claims,
    )
