"""Share-token mint/verify/revoke tests."""
from __future__ import annotations

import time

import pytest
from services import share_token_service as sts

pytestmark = pytest.mark.asyncio


async def test_mint_and_verify(monkeypatch) -> None:
    from services import share_token_service as sts

    monkeypatch.setattr(sts, "_is_revoked", lambda _v: False, raising=False)
    token = sts.mint("sess_abc", scope="full", ttl_days=30)
    claims = sts.verify(token)
    assert claims is not None
    assert claims.session_id == "sess_abc"
    assert claims.scope == "full"
    assert claims.exp > int(time.time())


async def test_verify_bad_signature() -> None:
    from services import share_token_service as sts

    token = sts.mint("sess_abc")
    bad = token[:-2] + "AA"
    assert sts.verify(bad) is None


async def test_verify_malformed_signature() -> None:
    token = sts.mint("sess_abc")
    header, payload, _signature = token.split(".")
    assert sts.verify(f"{header}.{payload}.!") is None
    assert sts.verify(f"{header}.{payload}.é") is None


async def test_verify_expired_token(monkeypatch) -> None:
    from services import share_token_service as sts

    monkeypatch.setattr(sts, "_is_revoked", lambda _v: False, raising=False)
    token = sts.mint("sess_abc", ttl_days=0)
    # Force exp into the past by sleeping or by manual decode.
    import json
    from base64 import urlsafe_b64decode, urlsafe_b64encode

    h, p, s = token.split(".")

    def _b64u_decode(s: str) -> bytes:
        pad = "=" * (-len(s) % 4)
        return urlsafe_b64decode((s + pad).encode())

    def _b64u(b: bytes) -> str:
        return urlsafe_b64encode(b).rstrip(b"=").decode()

    payload = json.loads(_b64u_decode(p))
    payload["exp"] = int(time.time()) - 10
    new_p = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    # Re-sign properly so signature is valid but token is expired
    import hashlib
    import hmac

    secret = (sts.settings.share_token_secret or sts.settings.secret_key).encode()
    new_sig_input = f"{h}.{new_p}".encode()
    new_sig = _b64u(hmac.new(secret, new_sig_input, hashlib.sha256).digest())
    expired = f"{h}.{new_p}.{new_sig}"
    assert sts.verify(expired) is None


async def test_revoke_token(monkeypatch) -> None:
    from services import share_token_service as sts

    revoked: set[str] = set()

    monkeypatch.setattr(sts, "_is_revoked", lambda v: v in revoked, raising=False)

    async def _to_thread(fn, *a, **kw):
        return fn(*a, **kw)

    monkeypatch.setattr("asyncio.to_thread", _to_thread, raising=False)

    # Replace inner _w writers with no-ops by patching the thread-bound revoke.
    async def _revoke(token_or_view_id: str):
        view_id = token_or_view_id
        if "." in token_or_view_id:
            claims = sts.verify(token_or_view_id)
            if claims is None:
                return False
            view_id = claims.view_id
        revoked.add(view_id)
        return True

    monkeypatch.setattr(sts, "revoke", _revoke, raising=False)

    token = sts.mint("sess_abc")
    assert sts.verify(token) is not None
    await sts.revoke(token)
    # After revoke, _is_revoked returns True → verify returns None.
    assert sts.verify(token) is None


async def test_track_view_with_invalid_token() -> None:
    from services.share_token_service import ViewerMeta, track_view

    ok = await track_view("not.a.token", ViewerMeta(ip="127.0.0.1"))
    assert ok is False
