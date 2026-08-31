"""Expiry status calculation tests."""

from datetime import date

import pytest

from app.config import settings
from app.expiry import EXPIRING_SOON_DAYS, ExpiryStatus, days_until_expiry, expiry_status, today


@pytest.mark.parametrize(
    "days,expected",
    [
        (-30, ExpiryStatus.EXPIRED),
        (-1, ExpiryStatus.EXPIRED),
        (0, ExpiryStatus.EXPIRING_SOON),
        (1, ExpiryStatus.EXPIRING_SOON),
        (7, ExpiryStatus.EXPIRING_SOON),
        (8, ExpiryStatus.FRESH),
        (365, ExpiryStatus.FRESH),
    ],
)
def test_status_buckets(days, expected):
    assert expiry_status(days) == expected


def test_expiring_today_is_not_yet_expired():
    """Food that expires today is still edible — the point is to prompt use."""
    assert expiry_status(0) == ExpiryStatus.EXPIRING_SOON


def test_the_boundary_is_inclusive():
    assert expiry_status(EXPIRING_SOON_DAYS) == ExpiryStatus.EXPIRING_SOON
    assert expiry_status(EXPIRING_SOON_DAYS + 1) == ExpiryStatus.FRESH


def test_days_until_expiry_counts_from_the_reference_date():
    reference = date(2026, 8, 29)
    assert days_until_expiry(date(2026, 9, 5), reference) == 7
    assert days_until_expiry(reference, reference) == 0
    assert days_until_expiry(date(2026, 8, 27), reference) == -2


def test_today_honours_the_configured_timezone(monkeypatch):
    """Guards against someone swapping in date.today().

    Kiritimati (UTC+14) and Niue (UTC-11) are 25 hours apart, so one is always
    on a later date than the other. Only the ordering is asserted, not the gap:
    25 hours means the difference is one day for 23 hours out of every 24, and
    two days for the remaining hour. Asserting one day passed locally and
    failed on CI at 10:34 UTC.
    """
    monkeypatch.setattr(settings, "timezone", "Pacific/Kiritimati")
    ahead = today()
    monkeypatch.setattr(settings, "timezone", "Pacific/Niue")
    behind = today()

    # date.today() would make these equal, which is the regression this catches.
    assert ahead > behind
