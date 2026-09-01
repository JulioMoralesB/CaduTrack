import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findDuplicateToday } from '@/duplicateCheck'
import type { Product } from '@/services/types'

const NOW = new Date('2026-09-01T18:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Leche entera',
    category_id: null,
    quantity: '2.00',
    unit: 'litros',
    expires_at: '2026-09-10',
    location: 'fridge',
    notes: null,
    category: null,
    icon: '\u{1F95B}',
    icon_source: 'lookup',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    consumed_at: null,
    days_until_expiry: 9,
    status: 'fresh',
    ...overrides,
  }
}

describe('findDuplicateToday', () => {
  it('matches a product with the exact same name created today', () => {
    const existing = product()

    expect(findDuplicateToday([existing], 'Leche entera')).toBe(existing)
  })

  it('matches regardless of case or surrounding whitespace', () => {
    const existing = product({ name: 'Leche Entera' })

    expect(findDuplicateToday([existing], '  leche entera  ')).toBe(existing)
  })

  it('does not match a product created on a previous day', () => {
    const existing = product({ created_at: '2026-08-31T12:00:00Z' })

    expect(findDuplicateToday([existing], 'Leche entera')).toBeNull()
  })

  it('does not match a same-day product already marked consumed', () => {
    const consumed = product({ consumed_at: '2026-09-01T15:00:00Z' })

    expect(findDuplicateToday([consumed], 'Leche entera')).toBeNull()
  })

  it('does not match a different name', () => {
    const existing = product({ name: 'Leche deslactosada' })

    expect(findDuplicateToday([existing], 'Leche entera')).toBeNull()
  })

  it('returns null for a blank name', () => {
    expect(findDuplicateToday([product()], '   ')).toBeNull()
  })

  it('returns null against an empty list', () => {
    expect(findDuplicateToday([], 'Leche entera')).toBeNull()
  })
})
