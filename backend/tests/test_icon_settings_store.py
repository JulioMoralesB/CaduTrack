"""Icon settings store tests."""

import pytest

from app.icon_settings_store import ai_enabled, get_or_create, update


@pytest.mark.integration
def test_defaults_to_enabled_on_first_read(db_session):
    stored = get_or_create(db_session)

    assert stored.ai_enabled is True


@pytest.mark.integration
def test_is_not_recreated_once_it_exists(db_session):
    update(db_session, ai_enabled=False)

    assert get_or_create(db_session).ai_enabled is False


@pytest.mark.integration
def test_ai_enabled_reads_the_plain_flag(db_session):
    update(db_session, ai_enabled=False)

    assert ai_enabled(db_session) is False
