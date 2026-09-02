import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StaleBanner } from '@/components/StaleBanner'

const NOW = new Date('2026-08-30T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

describe('StaleBanner', () => {
  it.each([
    [30 * 1000, 'hace unos segundos'],
    [60 * 1000, 'hace un minuto'],
    [25 * 60 * 1000, 'hace 25 minutos'],
    [60 * 60 * 1000, 'hace una hora'],
    [5 * 60 * 60 * 1000, 'hace 5 horas'],
    [24 * 60 * 60 * 1000, 'hace un día'],
    [3 * 24 * 60 * 60 * 1000, 'hace 3 días'],
  ])('describes an age of %i ms as "%s"', (elapsed, expected) => {
    render(<StaleBanner cachedAt={ago(elapsed)} />)

    expect(screen.getByRole('status')).toHaveTextContent(expected)
  })

  it('says plainly that the data is not current', () => {
    render(<StaleBanner cachedAt={ago(60_000)} />)

    // Data shown as if it were fresh is worse than an error, because you act on it.
    expect(screen.getByRole('status')).toHaveTextContent('Sin conexión')
    expect(screen.getByRole('status')).toHaveTextContent('datos guardados')
  })

  it('always offers the reauth link — see #112', () => {
    // This banner is the only place a Cloudflare Access session expiring is
    // ever visible: the service worker's own cache fallback (sw.ts) hides
    // the failure from axios entirely, so ProductList's own error-triggered
    // reauth link never gets a chance to render. Unconditional here for the
    // same reason it is harmless in that other state: a genuinely offline
    // device just gets a link that fails to load, no worse off than before.
    render(<StaleBanner cachedAt={ago(60_000)} />)

    const link = screen.getByRole('link', { name: 'reautentícate aquí' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/reauth'))
  })
})
