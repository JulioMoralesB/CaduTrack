"""Icon name-cache tests."""

import pytest

from app import icon_cache


@pytest.mark.integration
def test_a_fresh_name_is_a_miss(db_session):
    assert icon_cache.get(db_session, "kombucha") is None


@pytest.mark.integration
def test_a_remembered_name_is_found(db_session):
    icon_cache.remember(db_session, "kombucha", "\U0001F944")

    assert icon_cache.get(db_session, "kombucha") == "\U0001F944"


@pytest.mark.integration
def test_remembering_the_same_name_again_overwrites_rather_than_erroring(db_session):
    """Two concurrent requests for a brand-new name could each resolve it
    before either commits — the second write must win cleanly, not raise a
    duplicate-key error over an answer that is equally valid either way."""
    icon_cache.remember(db_session, "kombucha", "\U0001F944")
    icon_cache.remember(db_session, "kombucha", "\U0001F9C3")

    assert icon_cache.get(db_session, "kombucha") == "\U0001F9C3"
