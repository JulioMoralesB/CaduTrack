import { describe, expect, it } from 'vitest'

import { NO_FILTERS, applyFilters, hasActiveFilters, sortProducts } from '@/filters'
import type { Product } from '@/services/types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Leche entera',
    category_id: null,
    quantity: '1.00',
    unit: null,
    expires_at: '2026-09-03',
    location: 'fridge',
    notes: null,
    category: null,
    icon: '\u{1F95B}',
    icon_source: 'lookup',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    consumed_at: null,
    days_until_expiry: 5,
    status: 'expiring_soon',
    ...overrides,
  }
}

const pantry = [
  product({ id: 1, name: 'Yogur', category_id: 1, location: 'fridge', status: 'expired', days_until_expiry: -2 }),
  product({ id: 2, name: 'Queso', category_id: 1, location: 'fridge', status: 'expiring_soon', days_until_expiry: 3 }),
  product({ id: 3, name: 'Arroz', category_id: 2, location: 'pantry', status: 'fresh', days_until_expiry: 90 }),
  product({ id: 4, name: 'Ñame', category_id: 2, location: 'freezer', status: 'fresh', days_until_expiry: 90 }),
]

const names = (products: Product[]) => products.map((p) => p.name)

describe('applyFilters', () => {
  it('returns everything when nothing is selected', () => {
    expect(applyFilters(pantry, NO_FILTERS)).toHaveLength(4)
  })

  it('filters by category', () => {
    expect(names(applyFilters(pantry, { ...NO_FILTERS, categoryId: 2 }))).toEqual(['Arroz', 'Ñame'])
  })

  it('filters by location', () => {
    expect(names(applyFilters(pantry, { ...NO_FILTERS, location: 'freezer' }))).toEqual(['Ñame'])
  })

  it('filters by status', () => {
    expect(names(applyFilters(pantry, { ...NO_FILTERS, status: 'expired' }))).toEqual(['Yogur'])
  })

  it('combines filters rather than replacing them', () => {
    const result = applyFilters(pantry, { ...NO_FILTERS, categoryId: 2, location: 'pantry' })
    expect(names(result)).toEqual(['Arroz'])
  })

  it('returns nothing when the combination matches nothing', () => {
    expect(applyFilters(pantry, { ...NO_FILTERS, categoryId: 1, location: 'pantry' })).toEqual([])
  })

  it('matches uncategorised products only under "all"', () => {
    const loose = [product({ id: 9, name: 'Sal', category_id: null })]
    expect(applyFilters(loose, NO_FILTERS)).toHaveLength(1)
    expect(applyFilters(loose, { ...NO_FILTERS, categoryId: 1 })).toEqual([])
  })
})

describe('hasActiveFilters', () => {
  it('is false for the default filters', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
  })

  it.each([
    ['categoryId', { ...NO_FILTERS, categoryId: 1 as const }],
    ['location', { ...NO_FILTERS, location: 'fridge' as const }],
    ['status', { ...NO_FILTERS, status: 'fresh' as const }],
  ])('is true when %s is set', (_field, filters) => {
    expect(hasActiveFilters(filters)).toBe(true)
  })
})

describe('sortProducts', () => {
  it('puts what expires soonest first', () => {
    expect(names(sortProducts(pantry, 'expiry'))).toEqual(['Yogur', 'Queso', 'Arroz', 'Ñame'])
  })

  it('breaks expiry ties by name so the order is stable', () => {
    // Arroz and Ñame both sit at 90 days.
    const sorted = sortProducts([pantry[3], pantry[2]], 'expiry')
    expect(names(sorted)).toEqual(['Arroz', 'Ñame'])
  })

  it('sorts by name using Spanish collation', () => {
    // Ñ belongs between N and O, not after Z as a raw code-point sort gives.
    expect(names(sortProducts(pantry, 'name'))).toEqual(['Arroz', 'Ñame', 'Queso', 'Yogur'])
  })

  it('does not mutate the input', () => {
    const original = [...pantry]
    sortProducts(pantry, 'name')
    expect(pantry).toEqual(original)
  })
})
