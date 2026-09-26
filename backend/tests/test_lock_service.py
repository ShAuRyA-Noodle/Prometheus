"""Lock service tests — using an in-memory Firestore-like shim."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest

pytestmark = pytest.mark.asyncio


class _FakeDoc:
    def __init__(self, store: dict[str, dict], key: str) -> None:
        self._store = store
        self._key = key

    @property
    def exists(self) -> bool:
        return self._key in self._store

    def to_dict(self) -> dict | None:
        return self._store.get(self._key)


class _FakeRef:
    def __init__(self, store: dict[str, dict], key: str) -> None:
        self._store = store
        self._key = key

    def get(self, transaction=None):
        return _FakeDoc(self._store, self._key)


class _FakeTxn:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def set(self, ref: _FakeRef, data: dict) -> None:
        self._store[ref._key] = data

    def update(self, ref: _FakeRef, data: dict) -> None:
        self._store.setdefault(ref._key, {}).update(data)

    def delete(self, ref: _FakeRef) -> None:
        self._store.pop(ref._key, None)


class _FakeCollection:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def document(self, key: str) -> _FakeRef:
        return _FakeRef(self._store, key)


class _FakeDB:
    def __init__(self) -> None:
        self.store: dict[str, dict] = {}

    def collection(self, name: str) -> _FakeCollection:
        return _FakeCollection(self.store)

    def transaction(self) -> _FakeTxn:
        return _FakeTxn(self.store)


@pytest.fixture
def fake_lock_db(monkeypatch):
    """Patch services.lock_service so it uses our in-memory store."""
    from services import lock_service

    db = _FakeDB()
    monkeypatch.setattr(lock_service, "_db", lambda: db, raising=False)

    # google.cloud.firestore.transactional decorator that just executes synchronously.
    fake_gcfs = MagicMock()
    fake_gcfs.transactional = lambda fn: fn  # decorator no-op

    import sys

    monkeypatch.setitem(sys.modules, "google.cloud.firestore", fake_gcfs)
    return db


async def test_acquire_and_release(fake_lock_db) -> None:
    from services.lock_service import acquire, release

    token = await acquire("session:abc", ttl_seconds=60)
    assert token is not None
    assert "session:abc" in fake_lock_db.store

    ok = await release("session:abc", token)
    assert ok is True
    assert "session:abc" not in fake_lock_db.store


async def test_double_acquire_rejected(fake_lock_db) -> None:
    from services.lock_service import acquire

    t1 = await acquire("k1", ttl_seconds=60)
    assert t1 is not None
    t2 = await acquire("k1", ttl_seconds=60)
    assert t2 is None  # already held


async def test_release_with_wrong_token_fails(fake_lock_db) -> None:
    from services.lock_service import acquire, release

    await acquire("k2", ttl_seconds=60)
    ok = await release("k2", "not-the-real-token")
    assert ok is False


async def test_expired_lock_can_be_stolen(fake_lock_db) -> None:
    """When existing doc's expires_at is in the past, acquire steals it."""
    from services.lock_service import acquire

    fake_lock_db.store["k3"] = {
        "token": "old",
        "owner": "old_host",
        "expires_at": datetime.now(timezone.utc) - timedelta(seconds=10),
    }
    new_token = await acquire("k3", ttl_seconds=60)
    assert new_token is not None
    assert new_token != "old"


async def test_with_lock_context_manager(fake_lock_db) -> None:
    from services.lock_service import with_lock

    async with with_lock("k4", ttl_seconds=60) as token:
        assert isinstance(token, str)
        assert "k4" in fake_lock_db.store
    # Released after context exit.
    assert "k4" not in fake_lock_db.store
