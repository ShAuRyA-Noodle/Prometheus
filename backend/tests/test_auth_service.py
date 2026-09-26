"""Exercise real token service contracts used by auth routes and middleware."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from models.billing_models import SubscriptionTier
from models.user_models import User
from services import auth_service, firestore_service

pytestmark = pytest.mark.asyncio


async def test_session_token_round_trip() -> None:
    token, ttl = await auth_service.mint_session_jwt(
        uid="user-123",
        email="founder@example.com",
        is_anonymous=False,
        extra_claims={"locale": "en-US"},
    )
    claims = await auth_service.verify_session_jwt(token)
    assert ttl == 300
    assert claims["uid"] == "user-123"
    assert claims["email"] == "founder@example.com"
    assert claims["anonymous"] is False
    assert claims["locale"] == "en-US"


async def test_tampered_session_token_rejected() -> None:
    token, _ = await auth_service.mint_session_jwt(uid="user-123")
    with pytest.raises(ValueError, match="invalid session jwt"):
        await auth_service.verify_session_jwt(token + "tampered")


async def test_firebase_claims_are_returned_and_revocation_checked(monkeypatch) -> None:
    seen = {}

    def verify(token: str, *, check_revoked: bool) -> dict:
        seen["token"] = token
        seen["revoked"] = check_revoked
        return {"uid": "user-123", "firebase": {"sign_in_provider": "password"}}

    monkeypatch.setattr(auth_service, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth_service.fb_auth, "verify_id_token", verify)
    claims = await auth_service.verify_id_token("firebase-token")
    assert claims["uid"] == "user-123"
    assert seen == {"token": "firebase-token", "revoked": True}


async def test_firebase_claims_require_uid(monkeypatch) -> None:
    monkeypatch.setattr(auth_service, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth_service.fb_auth, "verify_id_token", lambda *_a, **_kw: {})
    with pytest.raises(ValueError, match="no uid"):
        await auth_service.verify_id_token("firebase-token")


@pytest.mark.parametrize(
    "route,body",
    [
        ("/api/auth/anon", {"firebase_anon_token": "firebase-token"}),
        ("/api/auth/verify", {"id_token": "firebase-token"}),
    ],
)
async def test_auth_route_requires_account_persistence(
    client, monkeypatch, route: str, body: dict[str, str]
) -> None:
    minted = False

    async def fail_store(**_kwargs) -> None:
        raise RuntimeError("Firestore unavailable")

    async def record_mint(**_kwargs) -> tuple[str, int]:
        nonlocal minted
        minted = True
        return "unsafe-token", 300

    monkeypatch.setattr(firestore_service, "ensure_user", fail_store)
    monkeypatch.setattr(auth_service, "mint_session_jwt", record_mint)
    response = await client.post(route, json=body)
    assert response.status_code == 503
    assert response.json()["code"] == "USER_STORE_UNAVAILABLE"
    assert not minted


async def test_existing_account_keeps_billing_tier(monkeypatch) -> None:
    account = User(uid="user-123", created_at=datetime.now(UTC), tier=SubscriptionTier.FOUNDER)
    saved = []

    async def get_user(_uid: str) -> User:
        return account

    async def upsert_user(user: User) -> None:
        saved.append(user)

    monkeypatch.setattr(firestore_service, "get_user", get_user)
    monkeypatch.setattr(firestore_service, "upsert_user", upsert_user)
    await firestore_service.ensure_user(uid="user-123", email="founder@example.com")
    assert saved and saved[0].tier == SubscriptionTier.FOUNDER
    assert saved[0].email == "founder@example.com"
