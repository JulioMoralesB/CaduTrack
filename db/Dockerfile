FROM postgres:16-alpine

# The official image runs anything in this directory once, only on a
# genuinely empty data directory — see init/01-create-app-role.sh. Baked in
# here rather than bind-mounted from the repo: a bind mount only works when
# whoever deploys this has the repo checked out next to compose.yaml, and
# the documented deploy path is copying just compose.yaml and .env — see
# #56's own follow-up. A published image needs nothing else on disk.
COPY init/ /docker-entrypoint-initdb.d/
