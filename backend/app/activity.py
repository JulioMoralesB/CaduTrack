"""Whether anyone is using CaduTrack, for an idle shutdown — see #215.

apollo is woken on demand and a script there turns it off again after a
stretch of nobody using it. /health tells that script three things: when a
person last made a request, when this process started, and whether work is
still in progress that a shutdown would cut off.

**What counts as a person:** a request whose Cf-Access-Jwt-Assertion
verifies against the Access app (signature, audience, expiry) and carries
an `email` claim — anything but /health and /summary. A service token's
JWT has no `email`, so machine clients never count; neither do Kuma and
the dashboard, which only ever read those two paths. Requests that skip
Cloudflare Access altogether (the LAN-only proxy hostname) carry no JWT and
never count either — a known, accepted gap.

**Never in a request's way:** the check runs on its own thread, after the
response is already on its way, so a slow or unreachable JWKS endpoint
cannot fail or delay anything. While one check is still running, others
are skipped rather than queued: activity is only needed to the minute, and
a JWKS outage must not pile up a thread per request.

In memory only: after a restart there is no activity yet, and `started_at`
says since when — exactly what an idle-shutdown script needs to know.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.access_auth import access_configured, verified_access_claims

# The routes machines poll. Compared after root_path is stripped, so the
# same rule holds behind nginx's /api prefix and in a direct request.
IGNORED_PATHS = frozenset({"/health", "/summary"})

_started_at = datetime.now(UTC)
_last_user_activity_at: datetime | None = None
_receipts_being_read = 0
_lock = threading.Lock()

_check_thread: threading.Thread | None = None


def started_at() -> datetime:
    return _started_at


def last_user_activity_at() -> datetime | None:
    return _last_user_activity_at


def _record(at: datetime) -> None:
    global _last_user_activity_at
    with _lock:
        # Checks can finish out of order; never move the time backwards.
        if _last_user_activity_at is None or at > _last_user_activity_at:
            _last_user_activity_at = at


def _check(token: str, at: datetime) -> None:
    claims = verified_access_claims(token)
    if claims is not None and claims.get("email"):
        _record(at)


def note_request(path: str, token: str | None, at: datetime) -> None:
    """Record a request as a person's, if it is one — see the module
    docstring. Returns at once; the verification runs on its own thread."""
    global _check_thread
    if not token or path in IGNORED_PATHS or not access_configured():
        return
    with _lock:
        if _check_thread is not None and _check_thread.is_alive():
            return
        _check_thread = threading.Thread(target=_check, args=(token, at), name="user-activity-check", daemon=True)
        _check_thread.start()


def wait_for_check(timeout: float = 5.0) -> None:
    """Block until the check in flight, if any, has finished. For tests."""
    thread = _check_thread
    if thread is not None:
        thread.join(timeout)


def reset() -> None:
    """Forget all recorded activity. For tests."""
    global _last_user_activity_at, _receipts_being_read
    wait_for_check()
    with _lock:
        _last_user_activity_at = None
        _receipts_being_read = 0


@contextmanager
def reading_receipt() -> Iterator[None]:
    """Marks a receipt as being read for as long as the block runs: a read
    takes up to two minutes on the vision model, and a shutdown halfway
    through would lose it — the photo isn't kept anywhere until it's done."""
    global _receipts_being_read
    with _lock:
        _receipts_being_read += 1
    try:
        yield
    finally:
        with _lock:
            _receipts_being_read -= 1


def receipt_being_read() -> bool:
    return _receipts_being_read > 0


def _route_path(request: Request) -> str:
    # Behind nginx the prefix is already stripped and root_path is set; a
    # path that still carries it is stripped here, so either way the
    # comparison is against the app's own route.
    path = request.url.path
    root_path = request.scope.get("root_path", "")
    if root_path and path.startswith(root_path):
        path = path[len(root_path) :] or "/"
    return path


class RecordUserActivity(BaseHTTPMiddleware):
    """See the module docstring."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # The time the request arrived, not when its check finishes.
        at = datetime.now(UTC)
        response = await call_next(request)
        try:
            note_request(_route_path(request), request.headers.get("cf-access-jwt-assertion"), at)
        except Exception:
            # Only bookkeeping: whatever goes wrong here, the response stands.
            pass
        return response
