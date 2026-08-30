#!/bin/sh
set -e

# The log directory is a bind mount owned by the host user, so fix ownership
# before dropping privileges — appuser cannot write to it otherwise.
if [ -d /mnt/logs ]; then
    chown -R appuser:appuser /mnt/logs
fi

# Each step logs its own progress as JSON. Plain `echo` announcements were
# removed deliberately: they were the last non-JSON lines in the stream, and a
# stream that is "JSON except for a few lines" needs a parser for the
# exceptions.
gosu appuser python -m app.db.bootstrap

gosu appuser alembic upgrade head

# Idempotent by design: inserts only the default categories that are missing,
# so running it on every start costs one query and changes nothing.
gosu appuser python -m app.seed

exec gosu appuser python -m app
