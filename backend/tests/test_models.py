"""Schema contract tests for the ORM models.

These run without a database — they assert the mapping itself, which is what
silently drifts when a model changes and nobody writes a migration.
"""

import pytest
from sqlalchemy import CheckConstraint

from app.models import Category, Location, Product


@pytest.mark.parametrize("model", [Category, Product])
def test_tables_live_in_the_service_schema(model):
    """Tables must be namespaced, since apollo-server-db is shared."""
    assert model.__table__.schema == "cadutrack"


def test_product_has_a_location_column():
    """Guards the field that filtering by fridge/freezer/pantry depends on."""
    assert "location" in Product.__table__.columns
    assert Product.__table__.columns["location"].nullable is False


def test_location_check_constraint_matches_the_enum():
    """The CHECK constraint and Location must not drift apart.

    Adding a member to Location without a migration would let the ORM accept a
    value the database rejects, so fail here instead of at runtime.
    """
    constraint = next(
        c
        for c in Product.__table__.constraints
        if isinstance(c, CheckConstraint) and c.name == "ck_products_location"
    )
    sql = str(constraint.sqltext)

    for location in Location:
        assert f"'{location.value}'" in sql
    # No stale values left behind by a removed enum member.
    assert sql.count("'") == 2 * len(Location)


def test_expires_at_is_indexed():
    """Every list view and the daily alert sorts or filters on this column."""
    indexed = {column.name for index in Product.__table__.indexes for column in index.columns}
    assert "expires_at" in indexed


def test_deleting_a_category_keeps_its_products():
    """Products must survive category deletion, just uncategorised."""
    fk = next(iter(Product.__table__.columns["category_id"].foreign_keys))
    assert fk.ondelete == "SET NULL"
    assert Product.__table__.columns["category_id"].nullable is True


def test_location_values_are_language_neutral():
    """Spanish labels belong in the frontend, not in the stored data."""
    assert {location.value for location in Location} == {"fridge", "freezer", "pantry"}
