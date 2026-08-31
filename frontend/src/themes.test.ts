/**
 * The palettes are data, and the thing that would break the app is a missing or
 * duplicated colour rather than an ugly one. Parsed from the stylesheet so a
 * new theme cannot be added without meeting the same bar.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { THEMES } from '@/theme'

// Read from disk rather than imported: vitest stubs CSS imports, and `?raw`
// comes back as an empty string, so every assertion would pass vacuously.
// A path from the project root, because import.meta.url under jsdom is an http
// URL from the dev server rather than a file one.
const css = readFileSync('src/themes.css', 'utf8')

const REQUIRED = [
  '--bg',
  '--surface',
  '--text',
  '--text-muted',
  '--border',
  '--accent',
  '--danger',
  '--on-fill',
  '--status-fresh',
  '--status-expiring-soon',
  '--status-expired',
]

function palette(theme: string, mode: string): Record<string, string> {
  const block = css.match(
    new RegExp(`\\[data-theme="${theme}"\\]\\[data-mode="${mode}"\\]\\s*\\{([^}]*)\\}`),
  )
  expect(block, `${theme}/${mode} has no block`).not.toBeNull()

  return Object.fromEntries(
    [...(block as RegExpMatchArray)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  )
}

describe.each(THEMES.map((t) => t.id))('theme %s', (theme) => {
  describe.each(['light', 'dark'])('%s', (mode) => {
    it('defines every token', () => {
      const tokens = palette(theme, mode)
      for (const name of REQUIRED) {
        expect(tokens[name], `${name} missing`).toBeTruthy()
      }
    })

    it('keeps the three expiry statuses distinguishable', () => {
      // They carry the meaning of the whole app. Two that match would make
      // expired and fresh look identical at a glance.
      const tokens = palette(theme, mode)
      const statuses = [tokens['--status-fresh'], tokens['--status-expiring-soon'], tokens['--status-expired']]
      expect(new Set(statuses).size).toBe(3)
    })

    it('does not use the surface colour for text', () => {
      const tokens = palette(theme, mode)
      expect(tokens['--text']).not.toBe(tokens['--surface'])
      expect(tokens['--text-muted']).not.toBe(tokens['--surface'])
    })
  })
})
