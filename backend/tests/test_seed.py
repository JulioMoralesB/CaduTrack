"""Tests for the default category seed."""

import pytest
from sqlalchemy import delete, select

from app.models import Category
from app.seed import DEFAULT_CATEGORIES, seed_categories


def test_default_categories_have_no_duplicates():
    """A duplicate would be silently swallowed by ON CONFLICT DO NOTHING."""
    assert len(set(DEFAULT_CATEGORIES)) == len(DEFAULT_CATEGORIES)


def test_default_categories_are_in_spanish():
    """Category names are user-facing labels, and the UI is Spanish."""
    english_leftovers = {"Dairy", "Meat", "Vegetables", "Fruits", "Grains", "Beverages", "Frozen", "Other"}
    assert not english_leftovers & set(DEFAULT_CATEGORIES)
    assert "Lácteos" in DEFAULT_CATEGORIES


@pytest.mark.integration
def test_seeding_twice_inserts_nothing_the_second_time(db_session):
    """The script runs on every deploy, so it must be idempotent."""
    db_session.execute(delete(Category))
    db_session.commit()

    assert seed_categories(db_session) == len(DEFAULT_CATEGORIES)
    assert seed_categories(db_session) == 0

    names = set(db_session.execute(select(Category.name)).scalars())
    assert names == set(DEFAULT_CATEGORIES)


@pytest.mark.integration
def test_seeding_fills_only_the_missing_categories(db_session):
    """Deleting one category and re-seeding must not duplicate the others."""
    db_session.execute(delete(Category))
    db_session.commit()
    seed_categories(db_session)

    db_session.execute(delete(Category).where(Category.name == "Snacks"))
    db_session.commit()

    assert seed_categories(db_session) == 1
    names = list(db_session.execute(select(Category.name)).scalars())
    assert len(names) == len(set(names)) == len(DEFAULT_CATEGORIES)
