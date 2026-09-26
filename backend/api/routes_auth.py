"""Auth: anonymous sessions, ID-token verification, GDPR delete."""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ._dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])
log = structlog.get_logger("api.auth")


class AnonRequest(BaseModel):
    firebase_anon_token: str  # Firebase anonymous ID token from client
    locale: str = "en-US"
    region: str = "US"


class TokenResponse(BaseModel):
    session_jwt: str
    uid: str
    expires_in: int
    is_anonymous: bool


class VerifyRequest(BaseModel):
    id_token: str


@router.post(
    "/anon",
    response_model=TokenResponse,
    summary="Exchange a Firebase anonymous ID token for a Prometheus session JWT.",
)
async def auth_anon(payload: AnonRequest) -> TokenResponse:
    from services import auth_service, firestore_service

    try:
        claims = await auth_service.verify_id_token(payload.firebase_anon_token)
    except Exception as e:  # noqa: BLE001
        log.warning("auth.anon.verify_failed", err=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_AUTH", "message": "could not verify Firebase token"},
        ) from e

    uid = claims.get("uid") or claims["sub"]
    is_anon = bool(claims.get("firebase", {}).get("sign_in_provider") == "anonymous"
                   or claims.get("anonymous"))

    try:
        await firestore_service.ensure_user(
            uid=uid,
            email=claims.get("email"),
            is_anonymous=is_anon,
            locale=payload.locale,
            region=payload.region,
        )
    except Exception as e:  # noqa: BLE001
        log.error("auth.anon.ensure_user_failed", err=str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "USER_STORE_UNAVAILABLE", "message": "could not save account"},
        ) from e

    jwt_token, expires_in = await auth_service.mint_session_jwt(
        uid=uid,
        email=claims.get("email"),
        is_anonymous=is_anon,
        extra_claims={"locale": payload.locale, "region": payload.region},
    )
    return TokenResponse(
        session_jwt=jwt_token,
        uid=uid,
        expires_in=expires_in,
        is_anonymous=is_anon,
    )


@router.post(
    "/verify",
    response_model=TokenResponse,
    summary="Verify a full Firebase ID token (post sign-in/sign-up) and mint a session JWT.",
)
async def auth_verify(payload: VerifyRequest) -> TokenResponse:
    from services import auth_service, firestore_service

    try:
        claims = await auth_service.verify_id_token(payload.id_token)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_AUTH", "message": "could not verify Firebase token"},
        ) from e

    uid = claims.get("uid") or claims["sub"]
    email = claims.get("email")

    try:
        await firestore_service.ensure_user(uid=uid, email=email, is_anonymous=False)
    except Exception as e:  # noqa: BLE001
        log.error("auth.verify.ensure_user_failed", err=str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "USER_STORE_UNAVAILABLE", "message": "could not save account"},
        ) from e

    jwt_token, expires_in = await auth_service.mint_session_jwt(
        uid=uid,
        email=email,
        is_anonymous=False,
    )
    return TokenResponse(
        session_jwt=jwt_token,
        uid=uid,
        expires_in=expires_in,
        is_anonymous=False,
    )


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="GDPR/CCPA delete: cascade-delete user + all sessions/outputs.",
)
async def delete_me(
    request: Request,
    user=Depends(get_current_user),
) -> None:
    from services import analytics_service, firestore_service

    log.info("gdpr.delete.requested", uid=user.uid)
    delete_fn = getattr(firestore_service, "cascade_delete_user", None)
    if callable(delete_fn):
        await delete_fn(user.uid)
    else:
        # Fallback: tombstone the user record + all sessions known.
        sessions = await firestore_service.get_user_companies(user.uid)
        for s in sessions or []:
            await firestore_service.tombstone_session(s.session_id)

    try:
        await analytics_service.track(
            event="gdpr_deletion",
            uid=user.uid,
            properties={"requested_via": "delete_me"},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("analytics.gdpr_track_failed", err=str(e))
    return None
