// Tests for the wake Worker. Plain Node, no dependencies: `node --test edge/wake/`.
// The Worker only uses web-standard APIs (fetch, Request, Response, WebCrypto),
// which Node 20+ provides globally, so this runs the real file unchanged.

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import worker, { resetKeyCacheForTests } from './worker.js'

const TEAM = 'example-team'
const AUD = 'aud-' + 'a'.repeat(60)
const ISSUER = `https://${TEAM}.cloudflareaccess.com`
const CERTS = `${ISSUER}/cdn-cgi/access/certs`
// Built, not pasted — see CLAUDE.md. Nothing here is a real webhook.
const WEBHOOK = 'https://ha.example.test/api/webhook/' + 'x'.repeat(32)

const env = { ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, HA_WEBHOOK_URL: WEBHOOK }

let keys
let calls
let haResponse

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

async function sign(claims, { kid = 'k1', privateKey = keys.privateKey } = {}) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })))
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

function userClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return { aud: [AUD], iss: ISSUER, exp: now + 300, nbf: now - 10, email: 'someone@example.test', ...overrides }
}

function request(method, token, init = {}) {
  const headers = new Headers(init.headers)
  if (token) headers.set('Cf-Access-Jwt-Assertion', token)
  return new Request('https://app.example.test/wake' + (init.query ?? ''), { method, headers, body: init.body })
}

beforeEach(async () => {
  resetKeyCacheForTests()
  keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  calls = []
  haResponse = () => new Response('', { status: 200 })
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
    if (String(url) === CERTS) return Response.json({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256' }] })
    if (String(url) === WEBHOOK) return haResponse()
    throw new Error(`unexpected fetch ${url}`)
  }
})

afterEach(() => {
  delete globalThis.fetch
})

const webhookCalls = () => calls.filter((call) => call.url === WEBHOOK)

describe('POST /wake', () => {
  it('asks Home Assistant to turn the server on, and nothing else', async () => {
    const response = await worker.fetch(request('POST', await sign(userClaims())), env)

    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { status: 'waking' })
    assert.equal(webhookCalls().length, 1)
    assert.equal(webhookCalls()[0].method, 'POST')
    // Nothing from the caller is passed on: the webhook only ever means one thing.
    assert.equal(webhookCalls()[0].body, undefined)
  })

  it('ignores whatever the caller sends along', async () => {
    const response = await worker.fetch(
      request('POST', await sign(userClaims()), {
        query: '?entity=switch.everything&action=turn_off',
        body: JSON.stringify({ entity_id: 'switch.other', service: 'turn_off' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
    )

    assert.equal(response.status, 202)
    assert.equal(webhookCalls().length, 1)
    assert.equal(webhookCalls()[0].url, WEBHOOK)
    assert.equal(webhookCalls()[0].body, undefined)
  })

  it('reports Home Assistant not answering as a 502', async () => {
    haResponse = () => {
      throw new TypeError('fetch failed')
    }

    const response = await worker.fetch(request('POST', await sign(userClaims())), env)

    assert.equal(response.status, 502)
  })

  it('reports Home Assistant refusing as a 502', async () => {
    haResponse = () => new Response('', { status: 500 })

    const response = await worker.fetch(request('POST', await sign(userClaims())), env)

    assert.equal(response.status, 502)
  })
})

describe('GET /wake', () => {
  it('only says the feature is here, without waking anything', async () => {
    const response = await worker.fetch(request('GET', await sign(userClaims())), env)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { wake: true })
    assert.equal(webhookCalls().length, 0)
  })
})

describe('other methods', () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    it(`refuses ${method}`, async () => {
      const response = await worker.fetch(request(method, await sign(userClaims())), env)

      assert.equal(response.status, 405)
      assert.equal(webhookCalls().length, 0)
    })
  }
})

describe('Access token — checked here too, not only at the edge', () => {
  const rejected = {
    'no token at all': async () => null,
    'a token for another application': async () => sign(userClaims({ aud: ['some-other-aud'] })),
    'a token from another team': async () => sign(userClaims({ iss: 'https://elsewhere.cloudflareaccess.com' })),
    'an expired token': async () => sign(userClaims({ exp: Math.floor(Date.now() / 1000) - 60 })),
    'a token not valid yet': async () => sign(userClaims({ nbf: Math.floor(Date.now() / 1000) + 600 })),
    'a token signed by a key Access never published': async () => {
      const other = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      )
      return sign(userClaims(), { privateKey: other.privateKey })
    },
    'a token naming a key that does not exist': async () => sign(userClaims(), { kid: 'nope' }),
    'a token that is not a JWT': async () => 'not.a.jwt',
    'a token with alg none': async () => {
      const [, payload] = (await sign(userClaims())).split('.')
      return `${b64url(new TextEncoder().encode(JSON.stringify({ alg: 'none', kid: 'k1' })))}.${payload}.`
    },
  }

  for (const [label, makeToken] of Object.entries(rejected)) {
    it(`refuses ${label}`, async () => {
      const response = await worker.fetch(request('POST', await makeToken()), env)

      assert.equal(response.status, 403)
      assert.equal(webhookCalls().length, 0)
    })
  }

  it('accepts the token from the CF_Authorization cookie when the header is missing', async () => {
    const token = await sign(userClaims())
    const response = await worker.fetch(request('POST', null, { headers: { Cookie: `other=1; CF_Authorization=${token}` } }), env)

    assert.equal(response.status, 202)
  })

  it('accepts an aud given as a single string', async () => {
    const response = await worker.fetch(request('POST', await sign(userClaims({ aud: AUD }))), env)

    assert.equal(response.status, 202)
  })

  it('fails closed when it was deployed without its settings', async () => {
    for (const missing of ['ACCESS_TEAM', 'ACCESS_AUD', 'HA_WEBHOOK_URL']) {
      const partial = { ...env, [missing]: '' }
      const response = await worker.fetch(request('POST', await sign(userClaims())), partial)

      assert.equal(response.status, 500, missing)
    }
    assert.equal(webhookCalls().length, 0)
  })
})
