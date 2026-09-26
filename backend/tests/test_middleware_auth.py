"""AuthMiddleware tests."""
from __future__ import annotations

import pytest

from services import auth_service, firestore_service

pytestmark = pytest.mark.asyncio


async def test_anonymous_routes_pass(client) -> None:
    r = await client.get("/health", headers={})
    assert r.status_code == 200


async def test_protected_route_requires_token(client, monkeypatch) -> None:
    async def _bad(t):
        raise RuntimeError("invalid")

    monkeypatch.setattr(auth_service, "verify_session_jwt", _bad, raising=False)
    monkeypatch.setattr(auth_service, "verify_id_token", _bad, raising=False)

    r = await client.get("/api/me", headers={"authorization": ""})
    assert r.status_code == 401


async def test_session_jwt_path(client) -> None:
    """Default conftest setup verifies session JWT successfully."""
    r = await client.get("/api/me", headers={"authorization": "Bearer test.session.jwt"})
    # Default mock + ensure_user shim returns the user.
    assert r.status_code in {200, 404}  # ensure_user might not have been called yet


async def test_firebase_id_token_fallback(client, monkeypatch, in_memory_firestore) -> None:
    """Session JWT verifier raises → falls back to Firebase ID."""
    async def _bad_session(t):
        raise RuntimeError("not a session jwt")

    async def _good_id(t):
        return {
            "sub": "uid_fb_test",
            "uid": "uid_fb_test",
            "email": "fb@example.com",
            "firebase": {"sign_in_provider": "password"},
        }

    monkeypatch.setattr(auth_service, "verify_session_jwt", _bad_session, raising=False)
    monkeypatch.setattr(auth_service, "verify_id_token", _good_id, raising=False)

    r = await client.get("/api/me", headers={"authorization": "Bearer firebase.id.token"})
    assert r.status_code in {200, 404}
    assert "uid_fb_test" in in_memory_firestore.users


async def test_firebase_id_token_requires_account_persistence(client, monkeypatch) -> None:
    async def reject_session(_token):
        raise ValueError("not a session token")

    async def verified_firebase(_token):
        return {"uid": "uid_fb_test", "email": "fb@example.com"}

    async def fail_store(**_kwargs):
        raise RuntimeError("Firestore unavailable")

    monkeypatch.setattr(auth_service, "verify_session_jwt", reject_session)
    monkeypatch.setattr(auth_service, "verify_id_token", verified_firebase)
    monkeypatch.setattr(firestore_service, "ensure_user", fail_store)
    r = await client.get("/api/me", headers={"authorization": "Bearer firebase.id.token"})
    assert r.status_code == 503
    assert r.json()["code"] == "USER_STORE_UNAVAILABLE"


async def test_invalid_token(client, monkeypatch) -> None:
    async def _bad(_t):
        raise RuntimeError("invalid")

    monkeypatch.setattr(auth_service, "verify_session_jwt", _bad, raising=False)
    monkeypatch.setattr(auth_service, "verify_id_token", _bad, raising=False)

    r = await client.get("/api/me", headers={"authorization": "Bearer bad"})
    assert r.status_code == 401
    assert r.json()["code"] == "INVALID_AUTH"
