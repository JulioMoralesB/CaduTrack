"""Cloudflare Access reauth landing page — see #96/the frontend's apiUrl.

Not a resource endpoint: it exists only as a destination the frontend can
send a same-window navigation to when the API looks unreachable, most often
because the Access session backing it expired. A `fetch` can never complete
Access's own interactive login on its own — only a real top-level navigation
to a URL under the protected hostname can — and the app's static shell (`/`)
cannot serve as that URL, since the PWA's service worker precaches and
serves it straight from storage without ever reaching the network. Anything
under `/vision`, `/products`, etc. would technically work the same way, but
would leave the user looking at raw JSON; this exists purely to be
friendlier than that, and to hand them back to the app in the same window —
important inside an installed PWA, which typically has nowhere to open a
second tab in the first place.

Reaching this function at all IS the proof reauthentication worked: it sits
behind the same Cloudflare Access application as every other route, so an
unauthenticated request never reaches it — Access intercepts it upstream
with its own login redirect. There is no auth check here because there is
nothing left to check.
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

_PAGE = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2;url=/">
<title>Sesión reanudada — CaduTrack</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #14170f;
    color: #f4f4f0;
    font-family: system-ui, -apple-system, sans-serif;
    text-align: center;
    padding: 1.5rem;
  }
  .card { max-width: 22rem; }
  .icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #b7bdae; margin: 0 0 1.5rem; font-size: 0.9375rem; }
  a {
    display: inline-block;
    padding: 0.6rem 1.25rem;
    background: #3f7d3a;
    color: #14170f;
    text-decoration: none;
    border-radius: 0.5rem;
    font-weight: 600;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon" aria-hidden="true">✅</div>
    <h1>Sesión reanudada</h1>
    <p>Ya iniciaste sesión. Volviendo a CaduTrack…</p>
    <a href="/">Volver ahora</a>
  </div>
</body>
</html>
"""


@router.get("/reauth", response_class=HTMLResponse, include_in_schema=False)
def reauth_confirmation() -> str:
    """A friendly confirmation, then back to the app — see the module docstring."""
    return _PAGE
