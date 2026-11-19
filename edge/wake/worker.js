/**
 * cadutrack-wake — turns the CaduTrack server on, on request.
 *
 * The server is not on around the clock. When the app finds it unreachable it
 * offers "Encender servidor", which calls this Worker at /wake on the app's own
 * hostname. The Worker runs on Cloudflare's edge, so it answers while the
 * server is off, and does exactly one thing: POST to a Home Assistant webhook
 * whose automation turns the server on.
 *
 *   GET  /wake  → 200 {"wake": true}     The app asks whether this exists, so
 *                                        a deployment without it never shows
 *                                        the button. Wakes nothing.
 *   POST /wake  → 202 {"status": "waking"}
 *
 * Nothing from the request is passed on — no body, no query, no headers. The
 * webhook URL lives in a Worker secret and the automation behind it can only
 * turn one switch on, so there is nothing a caller can change about what
 * happens.
 *
 * Who may call it: a Cloudflare Access application on the hostname already
 * stops anyone without a session before the request gets here. The Access
 * token is checked again here anyway, against Access's own published keys,
 * so that a route or policy change can never quietly leave this open. Same
 * rule the API follows in backend/app/access_auth.py.
 *
 * Plain JavaScript with no dependencies and no build step, so it can be pasted
 * straight into the dashboard editor. Settings, all required — it refuses to
 * do anything with any of them missing:
 *
 *   ACCESS_TEAM     variable  Access team name: "x" for x.cloudflareaccess.com
 *   ACCESS_AUD      variable  the Access application's AUD tag
 *   HA_WEBHOOK_URL  secret    https://<home assistant>/api/webhook/<id>
 *
 * See edge/wake/README.md for deploying it.
 */

/** How long to wait on Home Assistant before giving up. */
const WEBHOOK_TIMEOUT_MS = 10_000

/** How long Access's signing keys are reused before being fetched again. */
const KEY_CACHE_MS = 60 * 60 * 1000

/** Clock skew tolerated on exp/nbf. */
const LEEWAY_SECONDS = 60

let keyCache = { team: '', fetchedAt: 0, keys: new Map() }

/** Test hook: every test starts with no cached keys. */
export function resetKeyCacheForTests() {
  keyCache = { team: '', fetchedAt: 0, keys: new Map() }
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function decodeJsonPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)))
}

/** The Access token: the header Access adds, or its cookie as a fallback. */
function accessToken(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion')
  if (header) return header
  const cookies = request.headers.get('Cookie') ?? ''
  for (const cookie of cookies.split(';')) {
    const [name, ...rest] = cookie.trim().split('=')
    if (name === 'CF_Authorization') return rest.join('=')
  }
  return null
}

async function signingKey(team, kid) {
  const stale = keyCache.team !== team || Date.now() - keyCache.fetchedAt > KEY_CACHE_MS
  // An unknown kid also refetches: Access rotates its keys.
  if (stale || !keyCache.keys.has(kid)) {
    const response = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`)
    if (!response.ok) throw new Error(`Access certs answered ${response.status}`)
    const { keys = [] } = await response.json()
    const imported = new Map()
    for (const jwk of keys) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue
      imported.set(
        jwk.kid,
        await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
      )
    }
    keyCache = { team, fetchedAt: Date.now(), keys: imported }
  }
  return keyCache.keys.get(kid) ?? null
}

/** True only for a token Access signed, for this application, still in date. */
async function isValidAccessToken(token, env) {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false

  let header
  let claims
  try {
    header = decodeJsonPart(parts[0])
    claims = decodeJsonPart(parts[1])
  } catch {
    return false
  }
  // RS256 only: never let the token choose a weaker check, "none" included.
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false

  const key = await signingKey(env.ACCESS_TEAM, header.kid)
  if (!key) return false

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  if (!verified) return false

  const now = Math.floor(Date.now() / 1000)
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  return (
    audiences.includes(env.ACCESS_AUD) &&
    claims.iss === `https://${env.ACCESS_TEAM}.cloudflareaccess.com` &&
    typeof claims.exp === 'number' &&
    claims.exp + LEEWAY_SECONDS > now &&
    (claims.nbf === undefined || claims.nbf - LEEWAY_SECONDS <= now)
  )
}

export default {
  async fetch(request, env) {
    if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !env.HA_WEBHOOK_URL) {
      return json(500, { error: 'not configured' })
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return json(405, { error: 'method not allowed' }, { Allow: 'GET, POST' })
    }

    let allowed = false
    try {
      allowed = await isValidAccessToken(accessToken(request), env)
    } catch {
      // Access's keys could not be fetched: refuse rather than guess.
      allowed = false
    }
    if (!allowed) return json(403, { error: 'forbidden' })

    if (request.method === 'GET') return json(200, { wake: true })

    try {
      const response = await fetch(env.HA_WEBHOOK_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })
      if (!response.ok) return json(502, { error: 'home assistant refused' })
    } catch {
      return json(502, { error: 'home assistant unreachable' })
    }
    return json(202, { status: 'waking' })
  },
}
