"""Alembic environment configuration for CaduTrack.

Reads PostgreSQL connection parameters from app.config and applies migrations
within the schema owned by this service (``cadutrack`` by default) on the
shared apollo-server-db instance.
"""

import logging
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool, text

from alembic import context

# Make the backend root importable so we can use the app package.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models import *  # noqa: E402,F401,F403  — registers models on Base.metadata

# Alembic Config object, providing access to values from alembic.ini
alembic_config = context.config

# Interpret the config file for Python logging only when running from the
# Alembic CLI (i.e., logging has not been set up yet by the service).
# When invoked programmatically the root logger already has handlers, so we
# skip fileConfig to avoid clobbering the service's structured logging.
if alembic_config.config_file_name is not None and not logging.root.handlers:
    fileConfig(alembic_config.config_file_name)

# Models declare their schema via Base.metadata, so autogenerate can diff them.
target_metadata = Base.metadata


def _include_name(name, type_, parent_names) -> bool:
    """Restrict reflection to the schema this service owns.

    include_schemas=True makes Alembic reflect every schema in the database.
    Without this filter it also reflects public — where its own alembic_version
    table lives — and autogenerate proposes dropping it.
    """
    if type_ == "schema":
        return name == settings.db_schema
    return True


def _configure(**kwargs) -> None:
    """Shared context.configure options for both offline and online modes."""
    context.configure(
        target_metadata=target_metadata,
        # Alembic's own bookkeeping table stays in public, matching the
        # convention used by the other apollo-server services.
        version_table_schema="public",
        include_schemas=True,
        include_name=_include_name,
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (no live DB connection required)."""
    _configure(
        url=settings.database_url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode against a live database connection."""
    configuration = dict(alembic_config.get_section(alembic_config.config_ini_section) or {})
    configuration["sqlalchemy.url"] = settings.database_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # The service's schema must exist before any migration runs against it.
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.db_schema}"'))
        connection.commit()

        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
