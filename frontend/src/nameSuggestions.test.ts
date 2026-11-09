import { describe, expect, it } from 'vitest'

import { findNameSuggestion, matchNameSuggestions } from '@/nameSuggestions'
import type { ProductNameSuggestion } from '@/services/types'

function suggestion(overrides: Partial<ProductNameSuggestion> = {}): ProductNameSuggestion {
  return { name: 'Leche entera', category_id: 3, location: 'fridge', shelf_days: null, ...overrides }
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

describe('matchNameSuggestions — see #160', () => {
  const names = (typed: string, list: string[]) =>
    matchNameSuggestions(list.map((name) => suggestion({ name })), typed).map((match) => match.name)

  it('finds part of a name, ignoring case and accents', () => {
    expect(names('PLATA', ['Plátano', 'Leche'])).toEqual(['Plátano'])
    expect(names('entera', ['Leche entera'])).toEqual(['Leche entera'])
  })

  it('waits for two letters', () => {
    expect(names('l', ['Leche'])).toEqual([])
    expect(names('  ', ['Leche'])).toEqual([])
  })

  it('puts names starting with the text first', () => {
    expect(names('le', ['Pan de leche', 'Lechuga', 'Leche'])).toEqual(['Lechuga', 'Leche', 'Pan de leche'])
  })

  it('leaves out a name already typed in full', () => {
    expect(names('leche', ['Leche', 'Leche entera'])).toEqual(['Leche entera'])
  })

  it('still offers the accented spelling of what was typed without accents', () => {
    expect(names('platano', ['Plátano'])).toEqual(['Plátano'])
  })

  it('offers only a few', () => {
    expect(names('le', ['Le1', 'Le2', 'Le3', 'Le4', 'Le5', 'Le6', 'Le7'])).toHaveLength(5)
  })
})
