"""Unit tests for the login rate limiter (per-account and per-IP buckets)."""

import pytest

from app.services import rate_limit


@pytest.fixture(autouse=True)
def _clean_state():
    rate_limit._failures.clear()
    yield
    rate_limit._failures.clear()


def test_account_bucket_limits_after_max_attempts():
    for _ in range(rate_limit._MAX_ATTEMPTS):
        assert not rate_limit.is_rate_limited("1.2.3.4", "alice")
        rate_limit.record_failure("1.2.3.4", "alice")
    assert rate_limit.is_rate_limited("1.2.3.4", "alice")
    # A different username from a different IP is unaffected.
    assert not rate_limit.is_rate_limited("5.6.7.8", "bob")


def test_ip_bucket_limits_username_spraying():
    for i in range(rate_limit._MAX_ATTEMPTS_PER_IP):
        rate_limit.record_failure("1.2.3.4", f"user{i}")
    # A brand-new username from the same IP is now blocked…
    assert rate_limit.is_rate_limited("1.2.3.4", "fresh-username")
    # …but another IP is not.
    assert not rate_limit.is_rate_limited("9.9.9.9", "fresh-username")


def test_clear_failures_forgives_account_but_not_ip():
    for i in range(rate_limit._MAX_ATTEMPTS_PER_IP):
        rate_limit.record_failure("1.2.3.4", f"user{i}")
    rate_limit.clear_failures("1.2.3.4", "user0")
    # The IP bucket still blocks — success on one account must not reset it.
    assert rate_limit.is_rate_limited("1.2.3.4", "user0")


def test_username_matching_is_case_insensitive():
    for _ in range(rate_limit._MAX_ATTEMPTS):
        rate_limit.record_failure("1.2.3.4", "Alice")
    assert rate_limit.is_rate_limited("1.2.3.4", "alice")


def test_sweep_bounds_memory(monkeypatch):
    monkeypatch.setattr(rate_limit, "_SWEEP_THRESHOLD", 10)
    # Record stale failures for many unique usernames…
    old = rate_limit.time.time() - rate_limit._WINDOW_SECONDS - 1
    for i in range(20):
        rate_limit._failures[f"1.2.3.4:user{i}"] = [old]
    # …then a fresh failure triggers the sweep and drops all stale keys.
    rate_limit.record_failure("5.6.7.8", "eve")
    assert len(rate_limit._failures) == 2  # eve's account + ip buckets only
