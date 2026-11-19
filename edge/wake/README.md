# cadutrack-wake — turn the server on from the app

The server CaduTrack runs on is not on around the clock: it powers on for a
daily window and otherwise on demand, through a Home Assistant switch that
sends Wake-on-LAN. While it is off the installed app still opens and shows
the last list it saw (the service worker's cache, see `frontend/src/sw.ts`),
but nothing can be changed.

This adds a way to turn it on from the app itself.

```
 phone (app)                    Cloudflare edge                     home
 ───────────                    ───────────────                     ────
 "Encender servidor"
   POST /wake ───────────▶  Access (same app, same session)
                                  │ no session → 302 to login
                                  ▼
                            Worker cadutrack-wake
                              checks the Access token again
                              POST <HA webhook URL> ───────▶  Home Assistant
                                                               automation:
                                                               if switch is off
                                                               → switch.turn_on
                                                               → Wake-on-LAN
 GET /api/health every 5 s ◀─────────────────────────────────  server boots
 up to 4 min, then reload                                      (~2 min)
```

- **The app** (`frontend/src/hooks/useWakeServer.ts`) offers the button only
  while the server is unreachable — in the error state and in the "datos
  guardados" banner — and only if `GET /wake` answers `{"wake": true}`, so a
  deployment without this Worker never shows it. After the POST it checks
  `/api/health` every 5 s for up to 4 minutes, then reloads the data (not the
  page, so an open form survives). It shows "Encendiendo…" meanwhile, and a
  retry after a failure or a timeout.
- **The Worker** (`worker.js`) does one thing: POST to one Home Assistant
  webhook. It passes nothing from the request on — no body, no query, no
  headers — so a caller cannot change what happens. It checks the Cloudflare
  Access token itself, against Access's published keys, and refuses without
  a valid one, so a route or policy change can never leave it open. It runs
  on the edge, so it answers while the server is off. Free plan, no Cron
  Trigger, no storage.
- **The Home Assistant automation** only turns one switch on, and only if it
  is off. Its webhook id is the one secret in the chain: it lives in Home
  Assistant and in a Worker secret, never in this repository.

## Values to fill in

| Placeholder | What it is | Where it goes |
|---|---|---|
| `<WEBHOOK_ID>` | A long random string, e.g. `openssl rand -hex 32`. The only secret here. | Home Assistant automation (`webhook_id`), and inside `HA_WEBHOOK_URL` |
| `<HA_HOST>` | Home Assistant's public hostname (reached through its tunnel) | Inside `HA_WEBHOOK_URL` |
| `HA_WEBHOOK_URL` | `https://<HA_HOST>/api/webhook/<WEBHOOK_ID>` | Worker → Settings → Variables and Secrets, type **Secret** |
| `ACCESS_TEAM` | Access team name: `x` for `x.cloudflareaccess.com`. Same value as the API's `CF_ACCESS_TEAM_DOMAIN`. | Worker → Variables, type **Text** |
| `ACCESS_AUD` | The CaduTrack Access application's AUD tag (Zero Trust → Access → Applications → CaduTrack → Overview). Same value as the API's `CF_ACCESS_AUD`. | Worker → Variables, type **Text** |
| `<APP_HOST>` | The app's hostname, the one the Access application protects | Worker route `<APP_HOST>/wake` |
| `<SWITCH>` | The Home Assistant switch that powers the server on | Home Assistant automation |

## 1. Home Assistant

Settings → Automations → new → ⋮ → Edit in YAML:

```yaml
alias: "CaduTrack: encender servidor"
description: >-
  Turns the server on when the CaduTrack wake Worker asks.
  Does nothing if it is already on.
mode: single
triggers:
  - trigger: webhook
    webhook_id: "<WEBHOOK_ID>"
    allowed_methods:
      - POST
    # The call arrives through the tunnel, not from the LAN.
    local_only: false
conditions:
  - condition: state
    entity_id: <SWITCH>
    state: "off"
actions:
  - action: switch.turn_on
    target:
      entity_id: <SWITCH>
```

(`triggers`/`trigger:`/`action:` is the syntax since Home Assistant 2024.10;
older versions use `trigger`/`platform:`/`service:`.)

Home Assistant answers 200 to a webhook call whatever the id, so a wrong id
fails silently: check the automation's trace after the first real use.

## 2. Cloudflare Worker

All in the dashboard; nothing to build.

1. Workers & Pages → Create → Worker. Name it **`cadutrack-wake`**, deploy
   the starter, then Edit code: replace everything with `worker.js` from this
   folder and Deploy.
2. Settings → Variables and Secrets: add `ACCESS_TEAM` and `ACCESS_AUD`
   (Text) and `HA_WEBHOOK_URL` (Secret). The Worker answers 500 and does
   nothing until all three are set.
3. Settings → Domains & Routes:
   - Add a **Route**: `<APP_HOST>/wake` on the app's zone — exactly that
     path, no wildcard, so nothing else on the hostname goes through it.
   - Turn off the `workers.dev` URL and Preview URLs. They would reach the
     Worker without Access in front; the Worker's own token check refuses
     them anyway, but there is no reason to leave them open.

No change to the Access application is needed: it covers the whole hostname,
`/wake` included. Check that rather than assuming it — next step.

## 3. Check Access covers it

Without a session, both must be stopped by Access before the Worker runs —
a 302 to the team's login page, and no run in the automation's traces:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST https://<APP_HOST>/wake
```

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<APP_HOST>/wake
```

Expected: `302 https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<APP_HOST>?…`.
A `403 {"error":"forbidden"}` instead means the request reached the Worker
without Access in front — the Worker refused it, but the Access application
or the route needs fixing.

Then, from the app with the server off: "Encender servidor" should turn into
"Encendiendo el servidor…", the automation should show a run, and the list
should load on its own once the server is up.

## Tests

```bash
node --test edge/wake/
```

Plain Node, no dependencies: the Worker only uses web-standard APIs (fetch,
Request, Response, WebCrypto), which Node 20+ has built in. CI runs them in
the frontend job.
