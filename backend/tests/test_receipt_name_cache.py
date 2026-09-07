"""Receipt name-cache tests — see #126."""

import pytest

from app import receipt_name_cache


@pytest.mark.integration
def test_a_fresh_raw_text_is_a_miss(db_session):
    assert receipt_name_cache.get(db_session, "CHAMP CREMINI") is None


@pytest.mark.integration
def test_a_remembered_raw_text_is_found(db_session):
    receipt_name_cache.remember(db_session, "CHAMP CREMINI", "Champiñones cremini")

    assert receipt_name_cache.get(db_session, "CHAMP CREMINI") == "Champiñones cremini"


@pytest.mark.integration
def test_remembering_the_same_raw_text_again_overwrites_rather_than_erroring(db_session):
    """A later, corrected resolve for the same raw text should simply win
    over an earlier guess — same reasoning as icon_cache.remember."""
    receipt_name_cache.remember(db_session, "CHAMP CREMINI", "Champiñones")
    receipt_name_cache.remember(db_session, "CHAMP CREMINI", "Champiñones cremini")

    assert receipt_name_cache.get(db_session, "CHAMP CREMINI") == "Champiñones cremini"


@pytest.mark.integration
def test_lookup_is_case_and_accent_insensitive(db_session):
    receipt_name_cache.remember(db_session, "CHAMP CREMINI", "Champiñones cremini")

    assert receipt_name_cache.get(db_session, "champ cremini") == "Champiñones cremini"


@pytest.mark.integration
def test_lookup_ignores_incidental_whitespace_differences(db_session):
    """A receipt scanned twice can read the same printed line with
    different incidental spacing — that must not miss the cache."""
    receipt_name_cache.remember(db_session, "CHAMP   CREMINI", "Champiñones cremini")

    assert receipt_name_cache.get(db_session, "CHAMP CREMINI") == "Champiñones cremini"
