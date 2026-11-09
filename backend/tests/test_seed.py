"""Tests for the default category seed."""

import pytest
from sqlalchemy import delete, select, update

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


def test_no_category_duplicates_a_storage_location():
    """Storage state belongs in Product.location, not in the category list.

    A "Congelados" category would compete with location == "freezer" and make
    the category filter describe where food is rather than what it is.
    """
    assert "Congelados" not in DEFAULT_CATEGORIES


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
def test_seeding_does_not_bring_back_a_deleted_or_renamed_default(db_session):
    """#144: categories are editable, so a missing default may be on purpose —
    and the seed runs on every deploy."""
    db_session.execute(delete(Category))
    db_session.commit()
    seed_categories(db_session)

    db_session.execute(delete(Category).where(Category.name == "Otros"))
    db_session.execute(update(Category).where(Category.name == "Snacks").values(name="Botanas"))
    db_session.commit()

    assert seed_categories(db_session) == 0
    names = set(db_session.execute(select(Category.name)).scalars())
    assert "Otros" not in names
    assert "Snacks" not in names
    assert "Botanas" in names
