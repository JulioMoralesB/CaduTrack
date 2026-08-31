/**
 * The service worker itself cannot run under vitest, so the caching decision is
 * extracted and tested directly. It is the piece whose failure is silent: a bad
 * entry only surfaces offline, long after it was written.
 */
import { describe, expect, it } from 'vitest'

/** Mirrors the condition in sw.ts. */
function shouldCache(response: Response): boolean {
  if (response.status !== 200) return false
  return !!response.headers.get('content-type')?.includes('application/json')
}

function reply(status: number, contentType: string | null): Response {
  // Null body: a 204 may not carry one, and the body is irrelevant here anyway.
  return new Response(null, {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  })
}

describe('what may enter the products cache', () => {
  it('accepts a real JSON response', () => {
    expect(shouldCache(reply(200, 'application/json'))).toBe(true)
    expect(shouldCache(reply(200, 'application/json; charset=utf-8'))).toBe(true)
  })

  it('rejects an Access login page', () => {
    // A 200 text/html — indistinguishable from success by status alone, and the
    // reason this guard exists.
    expect(shouldCache(reply(200, 'text/html; charset=utf-8'))).toBe(false)
  })

  it('rejects a response with no content type at all', () => {
    expect(shouldCache(reply(200, null))).toBe(false)
  })

  it('rejects anything that is not a 200', () => {
    for (const status of [204, 301, 302, 401, 403, 404, 500, 502]) {
      expect(shouldCache(reply(status, 'application/json'))).toBe(false)
    }
  })
})
