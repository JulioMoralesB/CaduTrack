import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  readMode,
  readTheme,
  saveTheme,
} from '@/theme'

function systemPrefers(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-mode')
  systemPrefers(false)
})

describe('reading the stored choice', () => {
  it('falls back to the default when nothing is stored', () => {
    expect(readTheme()).toBe(DEFAULT_THEME)
    expect(readMode()).toBe(DEFAULT_MODE)
  })

  it('ignores a stored value that names no existing theme', () => {
    // A theme removed in a later release would otherwise render an unstyled page.
    localStorage.setItem('cadutrack:theme', 'un-tema-que-ya-no-existe')
    localStorage.setItem('cadutrack:mode', 'sepia')

    expect(readTheme()).toBe(DEFAULT_THEME)
    expect(readMode()).toBe(DEFAULT_MODE)
  })

  it('returns what was saved', () => {
    saveTheme('oceano', 'dark')

    expect(readTheme()).toBe('oceano')
    expect(readMode()).toBe('dark')
  })
})

describe('applying a choice', () => {
  it('writes both attributes onto the root element', () => {
    applyTheme('ciruela', 'light')

    expect(document.documentElement.dataset.theme).toBe('ciruela')
    expect(document.documentElement.dataset.mode).toBe('light')
  })

  it('resolves auto against the system, so the CSS never has to', () => {
    systemPrefers(true)
    applyTheme('bosque', 'auto')
    expect(document.documentElement.dataset.mode).toBe('dark')

    systemPrefers(false)
    applyTheme('bosque', 'auto')
    expect(document.documentElement.dataset.mode).toBe('light')
  })

  it('honours a forced mode over the system preference', () => {
    systemPrefers(true)

    applyTheme('bosque', 'light')

    expect(document.documentElement.dataset.mode).toBe('light')
  })
})

describe('the theme catalogue', () => {
  it('offers enough to be worth a picker', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(3)
  })

  it('has unique ids and three preview colours each', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
    for (const theme of THEMES) {
      expect(theme.preview).toHaveLength(3)
      expect(theme.name).toBeTruthy()
    }
  })
})
