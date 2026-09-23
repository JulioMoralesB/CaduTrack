import { describe, expect, it } from 'vitest'

import { findNameSuggestion } from '@/nameSuggestions'
import type { ProductNameSuggestion } from '@/services/types'

function suggestion(overrides: Partial<ProductNameSuggestion> = {}): ProductNameSuggestion {
  return { name: 'Leche entera', category_id: 3, location: 'fridge', ...overrides }
}

describe('findNameSuggestion', () => {
  it('matches a suggestion with the exact same name', () => {
    const existing = suggestion()

    expect(findNameSuggestion([existing], 'Leche entera')).toBe(existing)
  })

  it('matches regardless of case or surrounding whitespace', () => {
    const existing = suggestion({ name: 'Leche Entera' })

    expect(findNameSuggestion([existing], '  leche entera  ')).toBe(existing)
  })

  it('does not match a different name', () => {
    const existing = suggestion({ name: 'Leche deslactosada' })

    expect(findNameSuggestion([existing], 'Leche entera')).toBeNull()
  })

  it('returns null for a blank name', () => {
    expect(findNameSuggestion([suggestion()], '   ')).toBeNull()
  })

  it('returns null against an empty list', () => {
    expect(findNameSuggestion([], 'Leche entera')).toBeNull()
  })
})
