"""Declarative base shared by every ORM model."""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    """Base class for all CaduTrack ORM models.

    Every table lives in CaduTrack's own schema inside the shared
    apollo-server-db instance, so the schema is pinned on the metadata rather
    than repeated on each model. This also makes Alembic emit schema-qualified
    DDL instead of relying on the connection's search_path.
    """

    metadata = MetaData(
        schema=settings.db_schema,
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        },
    )
