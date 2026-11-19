"""Cloudflare Access + API key auth for mutating requests — see #114.

Applied as middleware, not a per-route dependency, so a route added later
does not silently need remembering to protect it — the exact gap that let
api_key sit documented but unenforced for as long as it did.

Two independent, optional mechanisms, either one sufficient:

- A valid Cloudflare Access session — the app's own normal browser path,
  already gated by a real login, verified here against Access's own
  published signing keys rather than trusting the presence of a header a
  direct LAN request could just as easily forge.
- A shared X-API-Key, for anything that is not a browser.

If neither api_key nor the Cloudflare Access settings are configured,
every request is allowed — matching what api_key has always documented
("leave empty to disable the check — only safe behind Cloudflare
Access"), so shipping this cannot, by itself, lock a deployment out of
its own product list. Once either mechanism is configured, a mutating
request must satisfy at least one of the ones that actually are.

GET/HEAD/OPTIONS are never checked — reads stay exactly as open as they
are today, including /summary's own separate, dedicated key (see
routers/summary.py) and Kuma's own read-only health monitoring.
"""

import logging
import threading

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from jwt import PyJWKClient
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.config import settings

logger = logging.getLogger(__name__)

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


# Built lazily, and rebuilt if the team domain changes — mainly for tests,
# which monkeypatch settings mid-run; a real deployment only ever has one
# value for the life of the process. Shared by this module's middleware and
# app/activity.py, so Cloudflare's keys are fetched and cached once.
_jwks_client: PyJWKClient | None = None
_jwks_client_domain: str | None = None
_jwks_lock = threading.Lock()


def access_configured() -> bool:
    """Whether Cloudflare Access verification is set up at all."""
    return bool(settings.cf_access_team_domain and settings.cf_access_aud)


def _jwks() -> PyJWKClient:
    global _jwks_client, _jwks_client_domain
    with _jwks_lock:
        if _jwks_client is None or _jwks_client_domain != settings.cf_access_team_domain:
            _jwks_client = PyJWKClient(
                f"https://{settings.cf_access_team_domain}.cloudflareaccess.com/cdn-cgi/access/certs"
            )
            _jwks_client_domain = settings.cf_access_team_domain
        return _jwks_client


def verified_access_claims(token: str | None) -> dict | None:
    """The claims of a Cloudflare Access JWT that verifies — signature,
    audience and expiry — or None for anything else, never raising."""
    if not token:
        return None
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=["RS256"], audience=settings.cf_access_aud)
    except jwt.PyJWTError as exc:
        # Never the exception text itself: a JWT's own claims can end up
        # in messages some libraries raise, and this is exactly the kind
        # of log line that ends up pasted somewhere. The class name is
        # enough to tell "expired" apart from "wrong audience" apart
        # from "bad signature".
        logger.warning("Rejected Cloudflare Access JWT: %s", exc.__class__.__name__)
        return None
    except Exception:
        # PyJWKClient's own network/parsing failures (Cloudflare
        # unreachable, an unexpected JWKS shape) are not jwt.PyJWTError
        # subclasses. A key-fetch failure must read as "not
        # authenticated", not as a 500 that reveals nothing useful and
        # hides an auth bypass behind an unrelated-looking crash.
        logger.warning("Could not verify Cloudflare Access JWT", exc_info=True)
        return None


class RequireAuthOnMutations(BaseHTTPMiddleware):
    """See the module docstring."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        key_configured = bool(settings.api_key)
        access_on = access_configured()
        if not key_configured and not access_on:
            return await call_next(request)

        has_key = key_configured and request.headers.get("x-api-key") == settings.api_key
        has_access = access_on and verified_access_claims(request.headers.get("cf-access-jwt-assertion")) is not None
        if not has_key and not has_access:
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})

        return await call_next(request)
