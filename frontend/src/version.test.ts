import { describe, expect, it } from 'vitest'

import { APP_VERSION } from '@/version'

describe('APP_VERSION', () => {
  it('falls back to "dev" when VITE_APP_VERSION was not set at build time', () => {
    // Vite inlines import.meta.env values at build time, so this cannot be
    // toggled per test the way a runtime env var could — it only proves the
    // fallback branch, which is also the only branch the test suite ever
    // actually runs under (VITE_APP_VERSION is never set for `vitest`,
    // matching a real `npm run dev`). The build-time-injection half of the
    // contract is what frontend/Dockerfile and the release workflow cover.
    expect(APP_VERSION).toBe('dev')
  })
})
