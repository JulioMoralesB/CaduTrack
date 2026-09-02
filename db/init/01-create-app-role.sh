#!/bin/sh
# Runs once, only when cadutrack-db's data directory is first initialized —
# the official postgres image's own docker-entrypoint-initdb.d convention.
# POSTGRES_USER is always a cluster superuser by construction (it is
# initdb's own bootstrap role, and the first role in any Postgres cluster
# cannot be anything else); this creates the actual, deliberately
# unprivileged role cadutrack-api connects as instead — see #56.
#
# Owning the database from CREATE DATABASE onward means no later
# ALTER ... OWNER TO is needed, and no window where the database exists
# but is owned by the superuser.
#
# CADUTRACK_DB_PASSWORD is trusted as-is: it becomes a single-quoted SQL
# literal below, so a password containing a single quote breaks this
# script — pick one without.
#
# "Cannot read any other database" holds structurally, not through an
# explicit REVOKE: this instance exists to hold exactly cadutrack and
# nothing else, ever, so there is no other database for the role to read.
# A REVOKE was tried and dropped — verified directly that Postgres's
# per-database CONNECT ACL is not inherited from template1, so there is no
# single statement here that would pre-authorize denying PUBLIC on some
# future database that does not exist yet.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<EOSQL
CREATE ROLE cadutrack WITH LOGIN PASSWORD '${CADUTRACK_DB_PASSWORD}';
CREATE DATABASE cadutrack OWNER cadutrack;
EOSQL
