#!/bin/sh
set -e

# The log directory is a bind mount owned by the host user, so fix ownership
# before dropping privileges — appuser cannot write to it otherwise.
if [ -d /mnt/logs ]; then
    chown -R appuser:appuser /mnt/logs
fi

echo "Ensuring the database exists…"
gosu appuser python -m app.db.bootstrap

echo "Applying database migrations…"
gosu appuser alembic upgrade head

# Idempotent by design: inserts only the default categories that are missing,
# so running it on every start costs one query and changes nothing.
echo "Seeding default categories…"
gosu appuser python -m app.seed

echo "Starting CaduTrack API on ${API_HOST:-0.0.0.0}:${API_PORT:-8001}…"
exec gosu appuser uvicorn app.main:app \
    --host "${API_HOST:-0.0.0.0}" \
    --port "${API_PORT:-8001}"
