FROM python:3.13-slim

# The release tag this image is built from — only the release workflow passes
# a real value here (via --build-arg VERSION=${{ github.ref_name }}); a local
# build stays "dev". Read by app/config.py and surfaced through /health and
# /settings, so a running container can be checked against what was actually
# tagged and pushed instead of assumed.
ARG VERSION=dev
ENV APP_VERSION=${VERSION}

WORKDIR /app

# Run as a non-root user, matching apollo-server-dashboard's backend image.
# gosu lets the entrypoint drop privileges after any root-only setup.
RUN groupadd --system --gid 1000 appuser \
    && useradd --system --no-create-home --shell /bin/false --uid 1000 --gid 1000 appuser \
    && apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x /app/entrypoint.sh

# CaduTrack's port: free-games-notifier already owns 8000 on the host.
EXPOSE 8001

ENTRYPOINT ["/app/entrypoint.sh"]
